// Learns from WhatsApp chat exports placed in the /reply folder.
// It reads what YOU replied to each message and later answers new messages with the closest match,
// like you would. Nothing here sends anything, autoreply.js does that.
const fs = require('fs')
const path = require('path')
const config = require('./config')

const DIR = path.join(__dirname, 'reply')
const RESERVED = new Set(['readme.txt', 'me.txt', 'fallback.txt', 'voice.txt'])
const THRESHOLD = 0.42

const DEFAULT_FALLBACK = ['hmm 🤔', 'hmm', 'hmmm 🤔', 'okay 🤔', 'i see', 'oh?', 'hm 🤔', 'go on 🤔']
const DEFAULT_VOICE = [
  "please I can't listen to your VN at the moment, type it 🙏",
  "I can't play voice notes right now, please type it out",
  "abeg type it, I can't listen to VNs at the moment",
  "I can't listen to your VN at the moment, just type it please"
]

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a
const pick = (l) => l[Math.floor(Math.random() * l.length)]

// ---------------------------------------------------------------- parsing
const LINE = /^[\u200e\u200f\u202a-\u202e]*\[?(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}),?\s+(\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s?[APap]\.?\s?[Mm]\.?)?)\]?\s*(?:[-–—]\s*)?(.*)$/
const SENDER = /^([^:]{1,60}?):\s([\s\S]*)$/
const MEDIA = /(<media omitted>|<attached:|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|contact card omitted|this message was deleted|you deleted this message|^null$|\(file attached\)|missed (voice|video) call|waiting for this message|\.(jpg|jpeg|png|opus|mp4|webp|pdf)\b)/i

function clean(text) {
  return text
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/<this message was edited>/gi, '')
    .replace(/\s+$/g, '')
    .trim()
}

function parseExport(raw) {
  const msgs = []
  for (const rawLine of raw.replace(/\r/g, '').split('\n')) {
    const mt = LINE.exec(rawLine)
    if (mt) {
      const s = SENDER.exec(mt[3])
      if (!s) {
        msgs.push(null) // system line, breaks the flow
        continue
      }
      msgs.push({ who: s[1].trim(), text: s[2] })
    } else if (msgs.length && msgs[msgs.length - 1]) {
      msgs[msgs.length - 1].text += '\n' + rawLine // continuation of a multi-line message
    }
  }
  return msgs.map((m) => (m ? { who: m.who, text: clean(m.text) } : null))
}

// ---------------------------------------------------------------- normalising text
const CANON = [
  [/\b(hi+|hey+|hello+|hola|yo+|helo|sup|heyo)\b/g, ' greetx '],
  [/\b(good )?(morning|mornin|gm)\b/g, ' gmorning '],
  [/\b(good )?(night|gn|goodnight)\b/g, ' gnight '],
  [/\b(good )?(afternoon|evening)\b/g, ' gday '],
  [/\b(how are you|how r u|how are u|hw r u|how you dey|how u dey|how you doing|how u doing|how far|how body|how is it going|how are things|hru|how you)\b/g, ' howru '],
  [/\b(whats up|wassup|wasup|wyd|wetin dey|what are you doing|what r u doing|wat u doing)\b/g, ' whatsup '],
  [/\b(thanks+|thank you|thank u|thx|tnx|ty|thanx)\b/g, ' thanksx '],
  [/\b(ok+|okay+|okey|kk+|k)\b/g, ' okx '],
  [/\b(yes|yeah|yep|yup|ya|yea|yh|yeh)\b/g, ' yesx '],
  [/\b(no|nope|nah|nop)\b/g, ' nox '],
  [/\b(lol|lmao|lmfao|haha+|hehe+|hahaha+|lool)\b/g, ' laughx '],
  [/\b(bye+|goodbye|cya|see you|see ya|later|ttyl|catch you later)\b/g, ' byex '],
  [/\b(please|pls|plz|abeg)\b/g, ' pls '],
  [/\bu\b/g, ' you '],
  [/\bur\b/g, ' your '],
  [/\br\b/g, ' are ']
]

function norm(s) {
  let t = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(.)\1{2,}/gu, '$1$1')
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\s]/gu, ' ')
    .replace(/(\p{Extended_Pictographic})/gu, ' $1 ')
  for (const [re, to] of CANON) t = t.replace(re, to)
  return t.replace(/\s+/g, ' ').trim()
}

function trigrams(s) {
  const p = `  ${s} `
  const set = new Set()
  for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3))
  return set
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

// ---------------------------------------------------------------- the engine
const state = { pairs: [], idf: new Map(), index: new Map(), files: [], skipped: [], fallback: DEFAULT_FALLBACK, voice: DEFAULT_VOICE, signature: '' }
const chats = new Map()

function readList(file, fallback) {
  try {
    const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    return lines.length ? lines : fallback
  } catch {
    return fallback
  }
}

function safeReply(lines) {
  return lines.every((l) => l && l.length <= 280 && !/https?:\/\/|www\.|@\S|\b\d{6,}\b|\S+@\S+\.\S+/i.test(l))
}

function buildPairs(msgs, meNames, otherHint) {
  const isMe = (who) => {
    const w = who.toLowerCase()
    return meNames.some((n) => w === n || w.includes(n) || (n.length > 3 && n.includes(w) && w.length > 3))
  }
  // 2-person chat where we only know the other person (from the file name): the other speaker is "me"
  const speakers = [...new Set(msgs.filter(Boolean).map((m) => m.who))]
  let meSet = speakers.filter(isMe)
  if (!meSet.length && otherHint && speakers.length === 2) {
    const other = speakers.find((s) => s.toLowerCase().includes(otherHint) || otherHint.includes(s.toLowerCase()))
    if (other) meSet = speakers.filter((s) => s !== other)
  }
  if (!meSet.length) return null

  // group consecutive messages of the same side into blocks
  const blocks = []
  for (const m of msgs) {
    if (!m || !m.text || MEDIA.test(m.text)) {
      continue
    }
    const me = meSet.includes(m.who)
    const last = blocks[blocks.length - 1]
    if (last && last.me === me && !last.sys) last.msgs.push(m.text)
    else blocks.push({ me, msgs: [m.text] })
  }
  const pairs = []
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1]
    const b = blocks[i]
    if (a.me || !b.me) continue
    const prompt = a.msgs[a.msgs.length - 1]
    const nPrompt = norm(prompt)
    if (!nPrompt) continue
    let reply = [b.msgs[0]]
    if (b.msgs[1] && b.msgs[1].length < 80) reply.push(b.msgs[1])
    if (!safeReply(reply)) {
      reply = [b.msgs[0]]
      if (!safeReply(reply)) continue
    }
    const prevMe = blocks[i - 2]?.me ? blocks[i - 2].msgs[blocks[i - 2].msgs.length - 1] : ''
    pairs.push({ prompt, nPrompt, reply, prevMe: norm(prevMe) })
  }
  return pairs
}

function signatureOf() {
  try {
    return fs.readdirSync(DIR).map((f) => `${f}:${fs.statSync(path.join(DIR, f)).mtimeMs}`).join('|')
  } catch {
    return ''
  }
}

function load() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })
  const readme = path.join(DIR, 'README.txt')
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        'AUTO-REPLY LEARNING FOLDER',
        '',
        '1. Open a WhatsApp chat between you and someone > menu > More > Export chat > Without media.',
        '2. Put the exported .txt file in this folder (keep the name, e.g. "WhatsApp Chat with John.txt").',
        '3. The bot learns what YOU replied to each message and answers like you.',
        '4. Run .reloadreply (or restart the bot). Use .replytest hello to try it.',
        '',
        'Optional files in this folder:',
        '  me.txt        your name(s) as shown in the export, one per line (needed only if the bot cannot tell which side is you)',
        '  fallback.txt  what to say when nothing matches, one per line (default: hmm 🤔)',
        '  voice.txt     what to say when someone sends a voice note, one per line',
        ''
      ].join('\n')
    )
  }
  const meNames = ['you', String(config.ownerName || '').toLowerCase(), ...readList('me.txt', []).map((n) => n.toLowerCase())].filter(Boolean)
  const pairs = []
  const files = []
  const skipped = []
  const seen = new Set()
  for (const f of fs.readdirSync(DIR)) {
    if (!f.toLowerCase().endsWith('.txt') || RESERVED.has(f.toLowerCase())) continue
    try {
      const raw = fs.readFileSync(path.join(DIR, f), 'utf8')
      const hint = (/chat with (.+?)\.txt$/i.exec(f) || [])[1]?.toLowerCase()
      const got = buildPairs(parseExport(raw), meNames, hint)
      if (!got) {
        skipped.push(f)
        continue
      }
      let added = 0
      for (const p of got) {
        const key = `${p.nPrompt}||${p.reply.join('\n')}`
        if (seen.has(key)) continue
        seen.add(key)
        pairs.push(p)
        added++
      }
      files.push({ name: f, pairs: added })
    } catch {
      skipped.push(f)
    }
  }

  // idf over words + inverted index over trigrams
  const df = new Map()
  const index = new Map()
  pairs.forEach((p, i) => {
    p.tokens = p.nPrompt.split(' ')
    p.tri = trigrams(p.nPrompt)
    for (const t of new Set(p.tokens)) df.set(t, (df.get(t) || 0) + 1)
    for (const g of p.tri) {
      if (!index.has(g)) index.set(g, [])
      index.get(g).push(i)
    }
  })
  const idf = new Map()
  for (const [t, n] of df) idf.set(t, Math.log(1 + pairs.length / n))
  Object.assign(state, {
    pairs,
    idf,
    index,
    files,
    skipped,
    fallback: readList('fallback.txt', DEFAULT_FALLBACK),
    voice: readList('voice.txt', DEFAULT_VOICE),
    signature: signatureOf()
  })
  return { pairs: pairs.length, files, skipped }
}

function refreshIfChanged() {
  if (state.signature !== signatureOf()) load()
}

function cosine(tokA, tokB) {
  const w = (t) => state.idf.get(t) || Math.log(2 + state.pairs.length)
  const va = new Map()
  const vb = new Map()
  for (const t of tokA) va.set(t, (va.get(t) || 0) + w(t))
  for (const t of tokB) vb.set(t, (vb.get(t) || 0) + w(t))
  let dot = 0
  let na = 0
  let nb = 0
  for (const [t, x] of va) {
    na += x * x
    if (vb.has(t)) dot += x * vb.get(t)
  }
  for (const x of vb.values()) nb += x * x
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

function similarity(nText, tokens, tri, p) {
  if (nText === p.nPrompt) return 1
  return 0.55 * cosine(tokens, p.tokens) + 0.45 * jaccard(tri, p.tri)
}

function candidates(nText, chat) {
  const tokens = nText.split(' ')
  const tri = trigrams(nText)
  const hits = new Map()
  for (const g of tri) for (const i of state.index.get(g) || []) hits.set(i, (hits.get(i) || 0) + 1)
  const ids = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([i]) => i)
  const out = []
  for (const i of ids) {
    const p = state.pairs[i]
    let score = similarity(nText, tokens, tri, p)
    // context: does what the person is answering look like what I said right before in this old chat?
    if (chat.lastReply && p.prevMe) {
      const ctx = jaccard(trigrams(chat.lastReply), trigrams(p.prevMe))
      score = score * 0.85 + ctx * 0.15
    }
    out.push({ p, score })
  }
  return out.sort((a, b) => b.score - a.score)
}

function chatState(id) {
  if (!chats.has(id)) chats.set(id, { recent: [], lastReply: '' })
  return chats.get(id)
}

// Returns { lines: [text,...], score, kind }
function reply(chatId, text) {
  refreshIfChanged()
  const chat = chatState(chatId)
  const nText = norm(text)
  let result = null
  if (nText && state.pairs.length) {
    const ranked = candidates(nText, chat)
    const best = ranked[0]
    if (best && best.score >= THRESHOLD) {
      // every reply that fits about as well as the best is a valid choice, so the same message gets varied answers
      let pool = ranked.filter((c) => c.score >= Math.max(THRESHOLD, best.score - 0.1))
      const fresh = pool.filter((c) => !chat.recent.includes(c.p.reply.join('\n')))
      if (fresh.length) pool = fresh
      let total = pool.reduce((s, c) => s + c.score ** 4, 0)
      let roll = Math.random() * total
      let chosen = pool[0]
      for (const c of pool) {
        roll -= c.score ** 4
        if (roll <= 0) {
          chosen = c
          break
        }
      }
      result = { lines: chosen.p.reply, score: chosen.score, kind: 'match' }
    }
  }
  if (!result) result = { lines: [pick(state.fallback)], score: 0, kind: 'fallback' }
  chat.recent.push(result.lines.join('\n'))
  if (chat.recent.length > 8) chat.recent.shift()
  chat.lastReply = norm(result.lines[result.lines.length - 1])
  return result
}

const voiceReply = () => pick(state.voice)

// for .replytest
function explain(text) {
  refreshIfChanged()
  const nText = norm(text)
  if (!nText || !state.pairs.length) return []
  return candidates(nText, { lastReply: '' }).slice(0, 3).map((c) => ({ prompt: c.p.prompt, reply: c.p.reply.join(' / '), score: c.score }))
}

const typingDelay = (lines) => Math.min(7000, Math.max(1500, 800 + lines.join(' ').length * 45)) + rand(0, 1500)
const info = () => ({ pairs: state.pairs.length, files: state.files, skipped: state.skipped })

module.exports = { load, reply, voiceReply, explain, typingDelay, info, THRESHOLD, norm }
