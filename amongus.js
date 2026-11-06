// Among Us for WhatsApp groups. State lives in memory only: when a game ends
// (or the bot restarts) every name and role is forgotten.
const fn = require('./functions')
const config = require('./config')

const games = new Map() // group jid -> game
const index = new Map() // player id (cleaned jid) -> group jid

const DEFAULTS = {
  imposters: 3, // wanted imposters (auto-capped for small lobbies)
  time: 20 * 60, // whole game, seconds
  meeting: 5 * 60, // automatic "general emergency" every X seconds
  vote: 90, // how long a vote lasts, seconds
  presses: 2, // emergency button presses per player
  cooldown: 60, // emergency button cooldown, seconds
  killcd: 20 // imposter kill cooldown, seconds
}
const MIN_PLAYERS = 4

const TASKS = [
  'fix the wiring in Electrical',
  'swipe the card in Admin',
  'empty the garbage in Cafeteria',
  'align the engine output',
  'download data in Weather',
  'calibrate the distributor',
  'scan yourself in MedBay',
  'fuel the engines'
]

const P = () => config.prefix || '.'
const ids = (m) => [m.sender, ...(m.senderIds || [])].map(fn.cleanJid)

// ---------- helpers ----------
function fmt(sec) {
  sec = Math.max(0, Math.round(sec))
  const mins = Math.floor(sec / 60)
  const s = sec % 60
  if (mins && s) return `${mins}m ${s}s`
  return mins ? `${mins}m` : `${s}s`
}

// "20m", "90s", "1m30s", "45" (plain number = minutes) -> seconds
function parseDuration(text) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  if (/^\d+$/.test(t)) return Number(t) * 60
  const re = /(\d+)(h|m|s)/g
  let total = 0
  let used = ''
  let x
  while ((x = re.exec(t))) {
    total += Number(x[1]) * { h: 3600, m: 60, s: 1 }[x[2]]
    used += x[0]
  }
  return used === t && total > 0 ? total : null
}

function gameOf(m) {
  for (const id of ids(m)) {
    const chat = index.get(id)
    if (chat && games.has(chat)) return games.get(chat)
  }
  return null
}

function playerOf(g, m) {
  const mine = ids(m)
  return [...g.players.values()].find((p) => p.ids.some((id) => mine.includes(id)))
}

function alive(g) {
  return [...g.players.values()].filter((p) => p.alive)
}
const aliveImps = (g) => alive(g).filter((p) => p.role === 'imposter')
const aliveCrew = (g) => alive(g).filter((p) => p.role === 'crew')

function findByName(g, query, onlyAlive) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return null
  const pool = [...g.players.values()].filter((p) => !onlyAlive || p.alive)
  const exact = pool.find((p) => p.name.toLowerCase() === q)
  if (exact) return exact
  const part = pool.filter((p) => p.name.toLowerCase().startsWith(q))
  return part.length === 1 ? part[0] : null
}

const say = (sock, jid, text, mentions) => sock.sendMessage(jid, mentions ? { text, mentions } : { text })
const dm = (sock, p, text) => sock.sendMessage(p.jid, { text })

function clearTimers(g) {
  for (const t of g.timers || []) clearTimeout(t)
  g.timers = []
  if (g.voteTimer) clearTimeout(g.voteTimer)
  g.voteTimer = null
}

function destroy(g) {
  clearTimers(g)
  g.phase = 'ended'
  for (const p of g.players.values()) for (const id of p.ids) if (index.get(id) === g.chat) index.delete(id)
  games.delete(g.chat)
}

function roleReveal(g) {
  const lines = [...g.players.values()].map((p) => `${p.role === 'imposter' ? '🔪' : '🧑‍🚀'} ${p.name}${p.role === 'imposter' ? ' (Imposter)' : ''}`)
  return lines.join('\n')
}

async function finish(sock, g, winner, why) {
  const text =
    winner === 'crew'
      ? `🏆 *CREWMATES WIN!*\n${why}`
      : `🔪 *IMPOSTERS WIN!*\n${why}`
  const final = `${text}\n\n*Roles were:*\n${roleReveal(g)}\n\nThanks for playing. Names have been wiped. Run ${P()}amongus to play again!`
  destroy(g)
  await say(sock, g.chat, final)
}

// returns true if the game just ended
async function checkWin(sock, g) {
  const imps = aliveImps(g).length
  const crew = aliveCrew(g).length
  if (imps === 0) {
    await finish(sock, g, 'crew', 'Every imposter has been voted out. Good job crew! 🎉')
    return true
  }
  if (imps >= crew) {
    await finish(sock, g, 'imposter', 'The imposters took over the ship. Nobody can stop them now. 💀')
    return true
  }
  return false
}

// ---------- lobby ----------
function lobbyText(g) {
  const list = [...g.players.values()].map((p, i) => `${i + 1}. ${p.name}${p.id === g.host ? ' 👑' : ''}`).join('\n')
  return `*Players (${g.players.size}):*\n${list}`
}

function settingsText(g) {
  const s = g.settings
  return (
    `⚙️ *AMONG US SETTINGS*\n` +
    `━━━━━━━━━━━━━━\n` +
    `🔪 Imposters: *${s.imposters}* (auto-lowered if too few players)\n` +
    `⏱️ Full game: *${fmt(s.time)}*\n` +
    `🚨 General emergency: every *${fmt(s.meeting)}*\n` +
    `🗳️ Voting time: *${fmt(s.vote)}*\n` +
    `🔘 Emergency presses per player: *${s.presses}*\n` +
    `❄️ Emergency cooldown: *${fmt(s.cooldown)}*\n` +
    `🗡️ Kill cooldown: *${fmt(s.killcd)}*\n` +
    `━━━━━━━━━━━━━━\n` +
    `*Change (host only):*\n` +
    `${P()}aus imposters 2\n` +
    `${P()}aus time 15m\n` +
    `${P()}aus emergency 3m  (general emergency interval)\n` +
    `${P()}aus vote 60s\n` +
    `${P()}aus presses 3\n` +
    `${P()}aus cooldown 30s\n` +
    `${P()}aus killcd 15s\n` +
    `${P()}aus reset\n` +
    `Time units: h, m, s (e.g. 1m30s). Crew size can't be set, it's whoever joins.`
  )
}

function addPlayer(g, m) {
  const p = {
    id: fn.cleanJid(m.sender),
    ids: ids(m),
    jid: m.sender,
    name: '',
    role: 'crew',
    alive: true,
    revealed: false,
    presses: 0,
    lastKill: 0
  }
  // default name = WhatsApp name, made unique; they can change it with .aun
  let base = String(m.pushName || 'Player').replace(/[@\n]/g, '').slice(0, 15) || 'Player'
  let name = base
  let i = 2
  while ([...g.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase())) name = `${base}${i++}`
  p.name = name
  g.players.set(p.id, p)
  for (const id of p.ids) index.set(id, g.chat)
  return p
}

// ---------- gameplay ----------
async function startGame(sock, g) {
  g.phase = 'countdown'
  await say(
    sock,
    g.chat,
    `🚀 *AMONG US*\n${g.players.size} players are on the ship.\nGet ready, check your DMs for your role...`
  )
  await fn.sleep(1500)
  for (const n of [5, 4, 3, 2, 1]) {
    if (g.phase === 'ended') return
    await say(sock, g.chat, `🛸 Game starting in *${n}*`)
    await fn.sleep(1000)
  }
  if (g.phase === 'ended') return

  // pick imposters
  const all = [...g.players.values()]
  const maxImps = Math.max(1, Math.floor((all.length - 1) / 2))
  const count = Math.min(g.settings.imposters, maxImps)
  // Fisher-Yates shuffle with crypto randomness: every player (host included) has an equal chance
  const shuffled = [...all]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = require('crypto').randomInt(i + 1)
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  shuffled.slice(0, count).forEach((p) => (p.role = 'imposter'))
  g.impCount = count

  const impNames = shuffled.slice(0, count).map((p) => p.name)
  const failed = []
  for (const p of all) {
    try {
      if (p.role === 'imposter') {
        const mates = impNames.filter((n) => n !== p.name)
        await dm(
          sock,
          p,
          `🔪 *YOU ARE AN IMPOSTER*\n\nYour name: *${p.name}*\n` +
            (mates.length ? `Your fellow imposters: *${mates.join(', ')}*\n` : 'You are the only imposter.\n') +
            `\nKill secretly (in THIS chat) with:\n${P()}aui kill <name>\nKill cooldown: ${fmt(g.settings.killcd)}\n\nAct normal in the group. Don't get caught. 🤫`
        )
      } else {
        await dm(
          sock,
          p,
          `🧑‍🚀 *YOU ARE A CREWMATE*\n\nYour name: *${p.name}*\nThere ${count === 1 ? 'is 1 imposter' : `are ${count} imposters`} among ${all.length} players.\n` +
            `Your task (just for fun): ${fn.pickRandom(TASKS)}.\n\nFind the imposters and vote them out!\nEmergency meeting: ${P()}aue (${g.settings.presses} presses)`
        )
      }
    } catch {
      failed.push(p)
    }
    await fn.sleep(400)
  }

  const now = Date.now()
  g.phase = 'playing'
  g.startedAt = now
  g.endsAt = now + g.settings.time * 1000
  g.lastEmergency = now // button starts on cooldown like the real game
  g.nextMeeting = now + g.settings.meeting * 1000
  for (const p of g.players.values()) {
    p.presses = g.settings.presses
    p.lastKill = now
  }
  g.dead = []

  let msg =
    `✅ *GAME STARTED!*\n\n` +
    `${all.length} players • ${count} imposter${count === 1 ? '' : 's'} among us 🔪\n` +
    `Imposters can now start murdering using ${P()}aui\n` +
    `⏱️ Game length: ${fmt(g.settings.time)}\n` +
    `🚨 General emergency meeting in ${fmt(g.settings.meeting)}\n` +
    `🔘 Found something? ${P()}aue calls an emergency meeting\n\n` +
    `*Players:*\n${all.map((p) => `• ${p.name}`).join('\n')}`
  if (failed.length) {
    msg += `\n\n⚠️ Couldn't DM: ${failed.map((p) => p.name).join(', ')}. Message the bot privately once and run ${P()}aur to get your role again.`
  }
  await say(sock, g.chat, msg)
  scheduleTimers(sock, g)
}

function scheduleTimers(sock, g) {
  const set = (ms, fnc) => g.timers.push(setTimeout(() => fnc().catch((e) => console.error('[amongus]', e.message)), Math.max(0, ms)))
  const left = () => g.endsAt - Date.now()

  // time warnings
  for (const warn of [600, 300, 60]) {
    if (g.settings.time > warn + 30) {
      set(left() - warn * 1000, async () => {
        if (g.phase === 'ended') return
        await say(sock, g.chat, `⏳ *${fmt(warn)} left!* Imposters still alive: ${g.impCount > 0 ? 'yes' : 'no'} 👀`)
      })
    }
  }
  // game over by time
  set(left(), async () => {
    if (g.phase === 'ended') return
    if (g.phase === 'voting') {
      g.timeUp = true
      return
    }
    await finish(sock, g, 'imposter', `Time ran out and ${aliveImps(g).length} imposter${aliveImps(g).length === 1 ? ' is' : 's are'} still hiding among you. 😈`)
  })
  scheduleGeneral(sock, g)
}

function scheduleGeneral(sock, g) {
  if (g.generalTimer) clearTimeout(g.generalTimer)
  const wait = g.nextMeeting - Date.now()
  if (wait >= g.endsAt - Date.now()) return // game ends first
  g.generalTimer = setTimeout(() => {
    if (g.phase === 'playing') startMeeting(sock, g, '🚨 *GENERAL EMERGENCY MEETING*\nThe ship called everyone to the cafeteria!').catch((e) => console.error('[amongus]', e.message))
    else scheduleGeneral(sock, g)
  }, Math.max(1000, wait))
  g.timers.push(g.generalTimer)
}

async function startMeeting(sock, g, headline) {
  g.phase = 'voting'
  g.votes = new Map()
  const dead = g.dead.splice(0)
  dead.forEach((p) => (p.revealed = true))
  g.ballot = alive(g)
  const list = g.ballot.map((p, i) => `${i + 1}. ${p.name}`).join('\n')
  const bodies = dead.length ? `💀 *Bodies found:* ${dead.map((p) => p.name).join(', ')}\n\n` : '💨 No bodies this time.\n\n'
  await say(
    sock,
    g.chat,
    `${headline}\n\n${bodies}` +
      `🗳️ *WHO IS THE IMPOSTER? VOTE NOW*\n━━━━━━━━━━━━━━\n${list}\n0. Skip vote\n━━━━━━━━━━━━━━\n` +
      `Vote with *${P()}auv <number or name>*\n(Vote in the bot's DM to keep it secret 🤫)\n` +
      `Dead players can't vote. You have *${fmt(g.settings.vote)}*.`
  )
  for (const p of dead) {
    dm(sock, p, '💀 You are dead. No talking or hints during the meeting!').catch(() => {})
  }
  g.voteTimer = setTimeout(() => endMeeting(sock, g).catch((e) => console.error('[amongus]', e.message)), g.settings.vote * 1000)
}

async function endMeeting(sock, g) {
  if (g.phase !== 'voting') return
  if (g.voteTimer) clearTimeout(g.voteTimer)
  g.voteTimer = null

  const tally = new Map()
  let skips = 0
  for (const target of g.votes.values()) {
    if (target === 'skip') skips++
    else tally.set(target, (tally.get(target) || 0) + 1)
  }
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1])
  const results =
    sorted.map(([id, n]) => `• ${g.players.get(id).name}: ${n} vote${n === 1 ? '' : 's'}`).join('\n') +
    (skips ? `\n• Skip: ${skips}` : '') || 'Nobody voted.'

  let out = `📊 *VOTING RESULTS*\n${results}\n\n`
  let ejected = null
  if (sorted.length && (sorted.length === 1 || sorted[0][1] > sorted[1][1]) && sorted[0][1] > skips) {
    ejected = g.players.get(sorted[0][0])
  }
  if (ejected) {
    ejected.alive = false
    ejected.revealed = true
    const left = aliveImps(g).length
    out += ejected.role === 'imposter'
      ? `🔪 *${ejected.name} was an Imposter!*\n${left} imposter${left === 1 ? '' : 's'} remaining.`
      : `😢 *${ejected.name} was NOT an Imposter.*\n${left} imposter${left === 1 ? '' : 's'} remaining.`
    dm(sock, ejected, '🚪 You were ejected into space. You are now a ghost.').catch(() => {})
  } else {
    out += '🤝 Tie or skipped. Nobody was ejected.'
  }
  await say(sock, g.chat, out)

  if (await checkWin(sock, g)) return
  if (g.timeUp || Date.now() >= g.endsAt) {
    return finish(sock, g, 'imposter', `Time ran out and ${aliveImps(g).length} imposter${aliveImps(g).length === 1 ? ' is' : 's are'} still alive. 😈`)
  }

  g.phase = 'playing'
  g.lastEmergency = Date.now()
  g.nextMeeting = Date.now() + g.settings.meeting * 1000
  for (const p of g.players.values()) p.lastKill = Date.now() // kill cooldown after meetings
  scheduleGeneral(sock, g)
  await say(sock, g.chat, `▶️ Back to the ship. ${fmt((g.endsAt - Date.now()) / 1000)} left. Imposters, resume murdering! 😈`)
}

// ---------- commands ----------
const guard = {
  groupOnly: (m) => (m.isGroup ? false : m.reply('🚫 Among Us is only available in groups, not in private chat.'))
}

async function cmdJoin(sock, m) {
  if (guard.groupOnly(m)) return
  let g = games.get(m.chat)
  const known = gameOf(m)
  if (!g) {
    if (known) return m.reply('You are already in an Among Us game in another group. Finish or leave it first.')
    g = {
      chat: m.chat,
      host: fn.cleanJid(m.sender),
      phase: 'lobby',
      players: new Map(),
      settings: { ...DEFAULTS },
      timers: [],
      dead: []
    }
    games.set(m.chat, g)
    const p = addPlayer(g, m)
    return sock.sendMessage(m.chat, {
      text:
        `🛸 *AMONG US* 🛸\n━━━━━━━━━━━━━━\n` +
        `@${fn.cleanJid(m.sender)} is the *host* 👑 and opened a lobby!\n\n` +
        `Anyone who wants to play: run *${P()}amongus*\n` +
        `Set your in-game name: *${P()}aun <your name>*\n\n` +
        `Host: ${P()}aus = settings • ${P()}startau = start • ${P()}exitau = cancel\n` +
        `Min ${MIN_PLAYERS} players, no max!\n━━━━━━━━━━━━━━\n` +
        `✅ You joined as *${p.name}*. What's your name? Type *${P()}aun <name>* to change it.`,
      mentions: [m.sender]
    })
  }
  if (g.phase !== 'lobby') return m.reply('⛔ A game is already running in this group. Wait for it to finish.')
  if (playerOf(g, m)) return m.reply(`You already joined as *${playerOf(g, m).name}*. Change name: ${P()}aun <name>`)
  if (known) return m.reply('You are already in an Among Us game in another group.')
  const p = addPlayer(g, m)
  await sock.sendMessage(m.chat, {
    text: `✅ @${fn.cleanJid(m.sender)} joined! (${g.players.size} players)\nYou are *${p.name}* for now. What's your name? Type *${P()}aun <name>* to choose the one you want.`,
    mentions: [m.sender]
  })
}

async function cmdName(sock, m, { text }) {
  const g = gameOf(m)
  if (!g) return m.reply(`You are not in a game. Run ${P()}amongus in a group first.`)
  if (g.phase !== 'lobby') return m.reply('Names are locked once the game starts.')
  const name = String(text || '').replace(/[@\n]/g, '').trim().slice(0, 15)
  if (!name) return m.reply(`Usage: ${P()}aun <your name>`)
  const p = playerOf(g, m)
  if ([...g.players.values()].some((x) => x !== p && x.name.toLowerCase() === name.toLowerCase())) {
    return m.reply('😅 Somebody already took that name. Pick another one.')
  }
  p.name = name
  await m.reply(`✅ You will be known as *${name}* for this game.`)
  if (!m.isGroup) await say(sock, g.chat, `✏️ A player is now called *${name}*`)
}

async function cmdSettings(sock, m, { args }) {
  if (guard.groupOnly(m)) return
  const g = games.get(m.chat)
  if (!g) return m.reply(`No lobby here. Start one with ${P()}amongus`)
  const key = (args[0] || '').toLowerCase()
  if (!key) return m.reply(settingsText(g))
  if (g.host !== fn.cleanJid(m.sender) && !m.isOwner) return m.reply('👑 Only the host can change settings.')
  if (g.phase !== 'lobby') return m.reply('Settings can only be changed before the game starts.')
  const s = g.settings
  const val = args.slice(1).join('')
  const num = (min, max) => {
    const n = parseInt(val, 10)
    return Number.isInteger(n) && n >= min && n <= max ? n : null
  }
  const secs = (min, max) => {
    const n = parseDuration(val)
    return n && n >= min && n <= max ? n : null
  }
  let done
  if (key === 'reset') {
    g.settings = { ...DEFAULTS }
    done = 'Settings reset to default.'
  } else if (['imposter', 'imposters', 'imp'].includes(key)) {
    const n = num(1, 10)
    if (!n) return m.reply('Imposters must be a number from 1 to 10.')
    s.imposters = n
    done = `Imposters: ${n}`
  } else if (['time', 'game', 'length'].includes(key)) {
    const n = secs(60, 3 * 3600)
    if (!n) return m.reply('Game time: between 1m and 3h, e.g. 20m or 90s.')
    s.time = n
    done = `Full game time: ${fmt(n)}`
  } else if (['emergency', 'general', 'meeting', 'gen'].includes(key)) {
    const n = secs(30, 3 * 3600)
    if (!n) return m.reply('General emergency interval: between 30s and 3h, e.g. 5m.')
    s.meeting = n
    done = `General emergency every: ${fmt(n)}`
  } else if (['vote', 'voting'].includes(key)) {
    const n = secs(15, 600)
    if (!n) return m.reply('Voting time: between 15s and 10m, e.g. 90s.')
    s.vote = n
    done = `Voting time: ${fmt(n)}`
  } else if (['presses', 'press', 'buttons', 'button'].includes(key)) {
    const n = num(0, 10)
    if (n === null) return m.reply('Presses must be a number from 0 to 10.')
    s.presses = n
    done = `Emergency presses per player: ${n}`
  } else if (['cooldown', 'cd'].includes(key)) {
    const n = secs(5, 1800)
    if (!n) return m.reply('Cooldown: between 5s and 30m, e.g. 1m.')
    s.cooldown = n
    done = `Emergency cooldown: ${fmt(n)}`
  } else if (['killcd', 'killcooldown', 'kcd'].includes(key)) {
    const n = secs(5, 600)
    if (!n) return m.reply('Kill cooldown: between 5s and 10m, e.g. 20s.')
    s.killcd = n
    done = `Kill cooldown: ${fmt(n)}`
  } else {
    return m.reply(settingsText(g))
  }
  await m.reply(`✅ ${done}\n\n${settingsText(g)}`)
}

async function cmdStart(sock, m) {
  if (guard.groupOnly(m)) return
  const g = games.get(m.chat)
  if (!g) return m.reply(`No lobby here. Start one with ${P()}amongus`)
  if (g.host !== fn.cleanJid(m.sender) && !m.isOwner) return m.reply('👑 Only the host can start the game.')
  if (g.phase !== 'lobby') return m.reply('The game already started.')
  if (g.players.size < MIN_PLAYERS) return m.reply(`Need at least ${MIN_PLAYERS} players (now ${g.players.size}). Tell the group to run ${P()}amongus`)
  startGame(sock, g).catch((e) => {
    console.error('[amongus] start', e)
    destroy(g)
    say(sock, g.chat, '❌ Something broke starting the game. It was cancelled.').catch(() => {})
  })
}

async function cmdKill(sock, m, { text }) {
  if (m.isGroup) return m.reply(`🤫 Use ${P()}aui in the bot's private chat, not the group!`)
  const g = gameOf(m)
  if (!g || g.phase === 'lobby') return m.reply('You are not in a running game.')
  const me = playerOf(g, m)
  if (me.role !== 'imposter') return m.reply('🧑‍🚀 You are not an imposter. Nice try.')
  if (!me.alive) return m.reply('💀 Ghosts cannot kill.')
  if (g.phase !== 'playing') return m.reply('Kills are disabled during a meeting.')
  const parts = text.trim().split(/ +/)
  if (!/^kill$/i.test(parts[0]) || parts.length < 2) return m.reply(`Usage: ${P()}aui kill <name>`)
  const target = findByName(g, parts.slice(1).join(' '), true)
  if (!target) return m.reply('Cannot find that alive player. Check the spelling.')
  if (target === me) return m.reply('Killing yourself? Bold, but no.')
  if (target.role === 'imposter') return m.reply('🔪 That is your fellow imposter!')
  const wait = me.lastKill + g.settings.killcd * 1000 - Date.now()
  if (wait > 0) return m.reply(`⏳ Kill cooldown: ${fmt(wait / 1000)}`)

  target.alive = false
  me.lastKill = Date.now()
  g.dead.push(target)
  await m.reply(`🔪 Imposter *${me.name}* killed *${target.name}* 🩸\n${aliveCrew(g).length} crew left.`)
  for (const p of g.players.values()) {
    if (p.role === 'imposter' && p !== me) dm(sock, p, `🔪 ${me.name} killed ${target.name}`).catch(() => {})
  }
  dm(sock, target, `💀 You were killed! You are a ghost now.\nDon't reveal anything in the group chat. Shhh.`).catch(() => {})
  await say(sock, g.chat, `☠️ *Someone was just murdered...* Report it with ${P()}aue!`)
  await checkWin(sock, g)
}

async function cmdEmergency(sock, m) {
  if (guard.groupOnly(m)) return
  const g = games.get(m.chat)
  if (!g || !['playing', 'voting'].includes(g.phase)) return m.reply('No running game here.')
  const me = playerOf(g, m)
  if (!me) return m.reply('You are not in this game.')
  if (!me.alive) return m.reply('💀 Ghosts cannot press the button.')
  if (g.phase === 'voting') return m.reply('A meeting is already happening, go vote!')
  if (me.presses <= 0) return m.reply('🔘 You have no emergency presses left!')
  const wait = g.lastEmergency + g.settings.cooldown * 1000 - Date.now()
  if (wait > 0) return m.reply(`❄️ Emergency button is cooling down: ${fmt(wait / 1000)} left`)
  me.presses--
  await startMeeting(sock, g, `🚨 *EMERGENCY MEETING!*\n*${me.name}* pressed the button! (${me.presses} press${me.presses === 1 ? '' : 'es'} left)`)
}

async function cmdVote(sock, m, { text }) {
  const g = gameOf(m)
  if (!g || g.phase === 'lobby') return m.reply('You are not in a running game.')
  if (g.phase !== 'voting') return m.reply('🗳️ There is no vote right now.')
  const me = playerOf(g, m)
  if (!me.alive) return m.reply('💀 Dead players cannot vote.')
  const q = text.trim()
  if (!q) return m.reply(`Usage: ${P()}auv <number or name> (0 = skip)`)
  let target
  if (/^(0|skip)$/i.test(q)) target = 'skip'
  else if (/^\d+$/.test(q)) target = g.ballot[Number(q) - 1]?.id
  else target = findByName(g, q, true)?.id
  if (!target) return m.reply('Invalid choice. Use a number from the list or a name.')
  g.votes.set(me.id, target)
  await m.reply(`✅ Vote locked: *${target === 'skip' ? 'Skip' : g.players.get(target).name}* (you can change it until time is up)`)
  if (m.isGroup) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
  await say(sock, g.chat, `🗳️ ${g.votes.size}/${alive(g).length} votes in`)
  if (g.votes.size >= alive(g).length) await endMeeting(sock, g)
}

async function cmdRole(sock, m) {
  const g = gameOf(m)
  if (!g || g.phase === 'lobby') return m.reply('You are not in a running game.')
  if (m.isGroup) return m.reply('Use this in the bot\'s private chat so nobody sees your role.')
  const me = playerOf(g, m)
  await m.reply(
    me.role === 'imposter'
      ? `🔪 You are an *IMPOSTER* named *${me.name}*.\nFellow: ${[...g.players.values()].filter((p) => p.role === 'imposter' && p !== me).map((p) => p.name).join(', ') || 'none'}`
      : `🧑‍🚀 You are a *CREWMATE* named *${me.name}*.`
  )
}

async function cmdPlayers(sock, m) {
  if (guard.groupOnly(m)) return
  const g = games.get(m.chat)
  if (!g) return m.reply(`No game here. Run ${P()}amongus`)
  if (g.phase === 'lobby') return m.reply(`🛸 *Lobby*\n${lobbyText(g)}`)
  const lines = [...g.players.values()].map((p) => `${p.revealed ? '💀' : '🟢'} ${p.name}`).join('\n')
  const left = Math.max(0, g.endsAt - Date.now()) / 1000
  await m.reply(`🛸 *Players*\n${lines}\n\n⏱️ Time left: ${fmt(left)}\n(Deaths show after a meeting)`)
}

async function cmdLeave(sock, m) {
  if (guard.groupOnly(m)) return
  const g = games.get(m.chat)
  const me = g && playerOf(g, m)
  if (!me) return m.reply('You are not in the lobby.')
  if (g.phase !== 'lobby') return m.reply('You cannot leave after the game starts.')
  if (g.host === me.id) return m.reply(`You are the host. Use ${P()}exitau to cancel the game.`)
  g.players.delete(me.id)
  for (const id of me.ids) index.delete(id)
  await m.reply(`👋 ${me.name} left the lobby.`)
}

async function cmdExit(sock, m) {
  if (guard.groupOnly(m)) return
  const g = games.get(m.chat)
  if (!g) return m.reply('No game running here.')
  if (g.host !== fn.cleanJid(m.sender) && !m.isOwner) return m.reply('👑 Only the host can end the game.')
  const reveal = g.phase !== 'lobby' && g.phase !== 'countdown' ? `\n\n*Roles were:*\n${roleReveal(g)}` : ''
  destroy(g)
  await m.reply(`🛑 *Among Us ended by the host.*${reveal}\nAll names have been wiped.`)
}

async function cmdInvite(sock, m, { args, text }) {
  if (guard.groupOnly(m)) return
  const target = m.mentionedJid?.[0] || (args[0] ? fn.toJid(args[0]) : null)
  if (!target) return m.reply(`Tag the person or give their number.\nExample: ${P()}inviteau @user  or  ${P()}inviteau 2348012345678`)
  if (fn.cleanJid(target) === fn.cleanJid(m.sender)) return m.reply("You can't invite yourself, just join with " + P() + 'amongus')

  let link
  try {
    const code = await sock.groupInviteCode(m.chat)
    link = `https://chat.whatsapp.com/${code}`
  } catch {
    return m.reply("I need to be admin here to fetch the group's invite link.")
  }

  const meta = await sock.groupMetadata(m.chat).catch(() => null)
  const groupName = meta?.subject || 'the group'
  const inviter = m.pushName || 'Someone'

  try {
    await sock.sendMessage(target, {
      text:
        `🛸 *AMONG US INVITE*\n\n` +
        `${inviter} invited you to play Among Us in *${groupName}*! 🔪🧑‍🚀\n\n` +
        `Join the group here:\n${link}\n\n` +
        `Already in the group? Just tap it to open the chat.\n\n` +
        `Once you're in, run *${P()}amongus* to join the game. If a round is already running, wait for the next one.`
    })
  } catch {
    return m.reply(`Couldn't DM @${fn.cleanJid(target)}. They may not have a DM open with me yet.`, { mentions: [target] })
  }

  await sock.sendMessage(m.chat, { text: `📨 Invite sent to @${fn.cleanJid(target)}!`, mentions: [target] })
}

module.exports = { cmdJoin, cmdName, cmdSettings, cmdStart, cmdKill, cmdEmergency, cmdVote, cmdRole, cmdPlayers, cmdLeave, cmdExit, cmdInvite }
