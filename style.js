const config = require('./config')
const store = require('./store')

// bold sans font: "Owner" -> "𝗢𝘄𝗻𝗲𝗿"
function boldFont(text) {
  return [...String(text)]
    .map((ch) => {
      const c = ch.codePointAt(0)
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65)
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97)
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48)
      return ch
    })
    .join('')
}

// Every theme decides how a message looks:
//   sig      first characters of its header (so we never wrap a message twice)
//   top      header line(s)         line   prefix of each text line
//   bottom   footer line            heading / item   used by the menu
const THEMES = [
  {
    name: 'Classic',
    sig: '╭── •',
    top: (t) => `╭── • ${t} • ──╮`,
    line: (l) => `│ ${l}`,
    blank: '│',
    bottom: '╰───────────────╯',
    heading: (h) => `❖ *${boldFont(h)}*`,
    item: (c) => ` ${c}`
  },
  {
    name: 'Neon',
    sig: '⚡━━',
    top: (t) => `⚡━━━━ ${t} ━━━━⚡`,
    line: (l) => `┃ ${l}`,
    blank: '┃',
    bottom: '⚡━━━━━━━━━━━━━━━⚡',
    heading: (h) => `⚡ *${boldFont(h)}*`,
    item: (c) => `› ${c}`
  },
  {
    name: 'Royal',
    sig: '♛ ═',
    top: (t) => `♛ ═══ ${boldFont(t)} ═══ ♛`,
    line: (l) => `║ ${l}`,
    blank: '║',
    bottom: '♛ ═════════════════ ♛',
    heading: (h) => `♛ *${boldFont(h)}*`,
    item: (c) => `✦ ${c}`
  },
  {
    name: 'Minimal',
    sig: '◈ ',
    top: (t) => `◈ *${t}*`,
    line: (l) => l,
    blank: '',
    bottom: '┈┈┈┈┈┈┈┈┈┈┈┈┈',
    heading: (h) => `*${boldFont(h)}*`,
    item: (c) => `• ${c}`
  },
  {
    name: 'Hacker',
    sig: '┌─[',
    top: (t) => `┌─[ root@${t.toLowerCase()} ]─[~]`,
    line: (l) => `│ ${l}`,
    blank: '│',
    bottom: '└─$ _',
    heading: (h) => `[+] *${h.toUpperCase()}*`,
    item: (c) => `> ${c}`
  },
  {
    name: 'Kawaii',
    sig: '₊˚⊹',
    top: (t) => `₊˚⊹ ♡ ${t} ♡ ⊹˚₊`,
    line: (l) => `♡ ${l}`,
    blank: '♡',
    bottom: '₊˚⊹ ♡ ⊹˚₊',
    heading: (h) => `🌸 *${boldFont(h)}*`,
    item: (c) => `♡ ${c}`
  },
  {
    name: 'Galaxy',
    sig: '✧･ﾟ:',
    top: (t) => `✧･ﾟ: *✧･ﾟ:* ${t} *:･ﾟ✧*:･ﾟ✧`,
    line: (l) => `✦ ${l}`,
    blank: '✦',
    bottom: '✧･ﾟ: *✧･ﾟ:*  *:･ﾟ✧*:･ﾟ✧',
    heading: (h) => `🌌 *${boldFont(h)}*`,
    item: (c) => `✧ ${c}`
  },
  {
    name: 'Blaze',
    sig: '🔥 ▬',
    top: (t) => `🔥 ▬▬▬ ${t} ▬▬▬ 🔥`,
    line: (l) => `▌${l}`,
    blank: '▌',
    bottom: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀',
    heading: (h) => `🔥 *${boldFont(h)}*`,
    item: (c) => `▸ ${c}`
  },
  {
    name: 'Arcade',
    sig: '╔═══ 🎮',
    top: (t) => `╔═══ 🎮 ${t} 🎮 ═══╗`,
    line: (l) => `║ ${l}`,
    blank: '║',
    bottom: '╚═════════════════╝',
    heading: (h) => `🕹️ *${boldFont(h)}*`,
    item: (c) => `▶ ${c}`
  },
  {
    name: 'Zen',
    sig: '┏━━━━━ 『',
    top: (t) => `┏━━━━━ 『 ${t} 』 ━━━━━┓`,
    line: (l) => `┃ ${l}`,
    blank: '┃',
    bottom: '┗━━━━━━━━━━━━━━━━━━━┛',
    heading: (h) => `✿ *${boldFont(h)}*`,
    item: (c) => `◦ ${c}`
  }
]

function themeId() {
  const n = Number(store.get().theme) || 1
  return n >= 1 && n <= THEMES.length ? n : 1
}
const getTheme = (id = themeId()) => THEMES[id - 1]

const alreadyStyled = (body) => THEMES.some((t) => body.startsWith(t.sig))

function box(text, title = config.botName || 'GIDEON', theme = getTheme()) {
  const body = String(text ?? '').replace(/\r/g, '').replace(/\s+$/g, '')
  if (!body) return body
  if (alreadyStyled(body)) return body
  const lines = body.split('\n').map((l) => (l.length ? theme.line(l.replace(/^ /, '')) : theme.blank))
  return [theme.top(String(title).toUpperCase()), ...lines, theme.bottom].join('\n')
}

// The full menu text in the active theme (no per-line prefix, so it stays short enough for one message)
function menuText({ title = config.botName || 'GIDEON', stats = [], sections = [], prefix = '.' }, theme = getTheme()) {
  const out = [theme.top(String(title).toUpperCase()), ...stats, '']
  for (const s of sections) {
    out.push(theme.heading(s.name))
    for (const c of s.cmds) out.push(theme.item(`${prefix}${c}`))
    out.push('')
  }
  out.push(theme.bottom)
  return out.join('\n')
}

function styledContent(content) {
  if (!content || typeof content !== 'object') return content
  if (content.react || content.delete || content.contacts || content.poll) return content
  const next = { ...content }
  if (typeof next.text === 'string') next.text = box(next.text)
  if (typeof next.caption === 'string' && next.caption.trim()) next.caption = box(next.caption)
  return next
}

function contentToMessage(content) {
  if (!content || typeof content !== 'object') return undefined
  if (content.text) return { extendedTextMessage: { text: content.text } }
  if (content.caption && content.image) return { imageMessage: { caption: content.caption } }
  if (content.caption && content.video) return { videoMessage: { caption: content.caption } }
  if (content.conversation) return { conversation: content.conversation }
  return undefined
}

module.exports = { box, menuText, styledContent, contentToMessage, THEMES, getTheme, themeId, boldFont }
