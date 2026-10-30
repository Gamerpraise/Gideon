const levels = require('../levels')
const store = require('../store')
const fn = require('../functions')

// ---------------------------------------------------------------- helpers
const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('en-US')
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a
const chance = (p) => Math.random() < p
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const CAT = 'economy'

function left(ms) {
  let s = Math.max(1, Math.ceil(ms / 1000))
  const d = Math.floor(s / 86400)
  s %= 86400
  const h = Math.floor(s / 3600)
  s %= 3600
  const mi = Math.floor(s / 60)
  s %= 60
  return [d && `${d}d`, h && `${h}h`, mi && `${mi}m`, (s || (!d && !h && !mi)) && `${s}s`].filter(Boolean).join(' ')
}

function eco(u) {
  const e = (u.eco = u.eco || {})
  e.bank = e.bank || 0
  e.loan = e.loan || 0
  e.loanDue = e.loanDue || 0
  e.jailUntil = e.jailUntil || 0
  e.inv = e.inv || {}
  e.cd = e.cd || {}
  e.boost = e.boost || {}
  e.job = e.job || null
  e.invest = e.invest || null
  e.crypto = e.crypto || 0
  e.biz = e.biz || null
  return e
}

const ecoOf = (num) => eco(levels.user(num))
const target = (m) => m.mentionedJid?.[0] || m.quoted?.sender || null
const numOf = (jid) => fn.cleanJid(jid)

// parse "500", "1k", "all", "half"
function parseAmt(s, all) {
  s = String(s || '').toLowerCase().replace(/,/g, '')
  if (s === 'all' || s === 'max') return all
  if (s === 'half') return Math.floor(all / 2)
  const k = /^(\d+(?:\.\d+)?)([km])?$/.exec(s)
  if (!k) return NaN
  let n = parseFloat(k[1])
  if (k[2] === 'k') n *= 1e3
  if (k[2] === 'm') n *= 1e6
  return Math.floor(n)
}

const inJail = (e) => e.jailUntil > Date.now()
const boostOn = (e, key) => (e.boost[key] || 0) > Date.now()

// put a user in jail (an armed Fake ID halves it once)
function jailUser(e, ms) {
  if (e.boost.fakeid) {
    ms = Math.ceil(ms / 2)
    delete e.boost.fakeid
  }
  e.jailUntil = Date.now() + ms
  return ms
}

// takes up to n coins (never below 0), returns what was really taken
function take(u, n) {
  const t = Math.min(Math.max(0, n), u.coins)
  u.coins -= t
  return t
}

// every economy command starts here: account + overdue-loan penalty
async function acct(m) {
  const num = numOf(m.sender)
  const u = levels.user(num)
  const e = eco(u)
  if (e.loan > 0 && e.loanDue && Date.now() > e.loanDue) {
    e.loanDue = Date.now() + DAY
    const ms = jailUser(e, 10 * MIN)
    store.save()
    await m.reply(`🚔 You did not pay your loan in 24h.\nYou were jailed for ${left(ms)}. You still owe 💰${fmt(e.loan)}. Use .payloan`)
  }
  return { num, u, e }
}

async function jailed(m, e) {
  if (!inJail(e)) return false
  await m.reply(`🔒 You are in jail for ${left(e.jailUntil - Date.now())}.\nWait it out or ask a friend to .bail you.`)
  return true
}

async function onCd(m, e, key, ms) {
  const wait = (e.cd[key] || 0) + ms - Date.now()
  if (wait > 0) {
    await m.reply(`⏳ ${key} is on cooldown. Try again in ${left(wait)}.`)
    return true
  }
  e.cd[key] = Date.now()
  return false
}

// ---------------------------------------------------------------- data
const ITEMS = {
  shield: { name: 'Shield', price: 1000, emoji: '🛡️' },
  luckycharm: { name: 'Lucky Charm', price: 800, emoji: '🍀' },
  pickaxe: { name: 'Pickaxe', price: 500, emoji: '⛏️' },
  fishingrod: { name: 'Fishing Rod', price: 500, emoji: '🎣' },
  energydrink: { name: 'Energy Drink', price: 300, emoji: '⚡' },
  fakeid: { name: 'Fake ID', price: 1500, emoji: '🪪' },
  goldwatch: { name: 'Gold Watch', price: 5000, emoji: '⌚' },
  diamondring: { name: 'Diamond Ring', price: 10000, emoji: '💍' }
}
const ITEM_ALIAS = { lucky: 'luckycharm', charm: 'luckycharm', rod: 'fishingrod', energy: 'energydrink', drink: 'energydrink', id: 'fakeid', watch: 'goldwatch', ring: 'diamondring', pick: 'pickaxe' }
function findItem(q) {
  const k = String(q || '').toLowerCase().replace(/[^a-z]/g, '')
  if (ITEMS[k]) return k
  return ITEM_ALIAS[k] || null
}

const JOBS = {
  driver: { name: 'Driver', min: 150, max: 250 },
  barber: { name: 'Barber', min: 120, max: 220 },
  chef: { name: 'Chef', min: 180, max: 300 },
  dj: { name: 'DJ', min: 200, max: 350 },
  tailor: { name: 'Tailor', min: 130, max: 240 }
}

const BIZ = {
  mamaput: { name: 'Mama Put', price: 2000 },
  bettingshop: { name: 'Betting Shop', price: 5000 },
  boutique: { name: 'Boutique', price: 8000 },
  carwash: { name: 'Car Wash', price: 10000 },
  restaurant: { name: 'Restaurant', price: 15000 }
}
const UPG = { 2: 2000, 3: 4000, 4: 8000, 5: 15000 }
const bizHourly = (b) => Math.floor(BIZ[b.type].price * 0.1 * (1 + 0.5 * (b.level - 1)))
function bizValue(b) {
  if (!b) return 0
  let v = BIZ[b.type].price
  for (let l = 2; l <= b.level; l++) v += UPG[l]
  return v
}
function findBiz(q) {
  const k = String(q || '').toLowerCase().replace(/[^a-z]/g, '')
  if (!k) return null
  return Object.keys(BIZ).find((x) => x === k || x.startsWith(k) || BIZ[x].name.toLowerCase().replace(/ /g, '').includes(k)) || null
}

const netWorth = (u) => Math.max(0, u.coins + eco(u).bank + bizValue(eco(u).biz) - eco(u).loan)

const HUSTLES = ['sold recharge cards', 'flipped sneakers', 'did a quick logo gig', 'resold airtime', 'helped a friend move', 'sold pure water', 'ran errands', 'edited wedding pictures']
const WORKS = ['worked a long shift', 'finished a client project', 'delivered orders', 'fixed some phones', 'closed a big sale']

// ---------------------------------------------------------------- crypto market
function market() {
  const db = store.get()
  if (!db.crypto) db.crypto = { price: 100, at: Date.now(), change: 0 }
  const c = db.crypto
  const steps = Math.min(12, Math.floor((Date.now() - c.at) / (5 * MIN)))
  for (let i = 0; i < steps; i++) {
    const pct = rand(-200, 200) / 1000
    const next = Math.min(1000, Math.max(10, c.price * (1 + pct)))
    c.change = ((next - c.price) / c.price) * 100
    c.price = next
  }
  if (steps) {
    c.at = Date.now()
    store.save()
  }
  return c
}

// ---------------------------------------------------------------- blackjack
const bjGames = new Map()
const SUITS = ['♠️', '♥️', '♦️', '♣️']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
function deck() {
  const d = []
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s })
  for (let i = d.length - 1; i > 0; i--) {
    const j = rand(0, i)
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}
function handValue(h) {
  let v = 0
  let aces = 0
  for (const c of h) {
    if (c.r === 'A') {
      aces++
      v += 11
    } else v += ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r)
  }
  while (v > 21 && aces) {
    v -= 10
    aces--
  }
  return v
}
const showHand = (h) => `${h.map((c) => c.r + c.s).join(' ')} (${handValue(h)})`

// ---------------------------------------------------------------- in-memory game state
const heists = new Map() // chat -> { members: Map(num->jid), timer }
const lastRob = new Map() // chat -> { robber, victim, amount, at, checked }
const trades = new Map() // target num -> offer
const lotTimers = new Map()

const MAX_BET = 5000
const MIN_BET = 50

// ---------------------------------------------------------------- command factory
function cmd(name, desc, run, extra = {}) {
  return { name, desc, category: CAT, ...extra, run }
}

// earning actions: account, jail check, cooldown, then the action returns the reply text
function earn(name, desc, cooldown, action, extra = {}) {
  return cmd(
    name,
    desc,
    async (sock, m, ctx) => {
      const { u, e } = await acct(m)
      if (await jailed(m, e)) return
      if (cooldown && (await onCd(m, e, name, cooldown))) return
      const text = await action({ u, e, m, ctx })
      store.save()
      if (text) await m.reply(text)
    },
    extra
  )
}

async function groupNets(sock, m) {
  const meta = await sock.groupMetadata(m.chat)
  const db = store.get().users || {}
  const rows = []
  for (const p of meta.participants) {
    const candidates = [p.phoneNumber, p.id, p.lid, p.jid].filter(Boolean).map(numOf)
    const id = candidates.find((c) => db[c])
    if (id) rows.push({ id, net: netWorth(db[id]) })
  }
  return rows.sort((a, b) => b.net - a.net)
}

// ---------------------------------------------------------------- lottery
async function drawLottery(sock, chat) {
  const db = store.get()
  const l = db.lottery?.[chat]
  if (!l) return null
  delete db.lottery[chat]
  clearTimeout(lotTimers.get(chat))
  lotTimers.delete(chat)
  if (!l.tickets.length) return null
  const winner = pick(l.tickets)
  levels.user(winner).coins += l.pot
  store.save()
  const text = `🎟️ *LOTTERY DRAW*\n\nThe pot of 💰${fmt(l.pot)} goes to @${winner}! 🎉\n(${l.tickets.length} ticket${l.tickets.length === 1 ? '' : 's'} were sold)`
  await sock.sendMessage(chat, { text, mentions: [fn.toJid(winner)] }).catch(() => {})
  return text
}
function armLottery(sock, chat) {
  const l = store.get().lottery?.[chat]
  if (!l || lotTimers.has(chat)) return
  lotTimers.set(
    chat,
    setTimeout(() => drawLottery(sock, chat).catch(() => {}), Math.max(1000, l.drawAt - Date.now()))
  )
}

// ---------------------------------------------------------------- blackjack settle
function settleBj(num, game, standing) {
  const u = levels.user(num)
  while (handValue(game.d) < 17) game.d.push(game.deck.pop())
  const p = handValue(game.p)
  const d = handValue(game.d)
  bjGames.delete(num)
  clearTimeout(game.timer)
  let result
  if (p > 21) result = 'bust'
  else if (d > 21 || p > d) result = 'win'
  else if (p === d) result = 'draw'
  else result = 'lose'
  if (result === 'win') u.coins += game.bet * 2
  if (result === 'draw') u.coins += game.bet
  store.save()
  const head = { bust: `💥 Bust! You lost 💰${fmt(game.bet)}.`, win: `🎉 You win 💰${fmt(game.bet)}!`, draw: `🤝 Draw, your 💰${fmt(game.bet)} is refunded.`, lose: `😔 Dealer wins. You lost 💰${fmt(game.bet)}.` }[result]
  return `🃏 *BLACKJACK*\nYou: ${showHand(game.p)}\nDealer: ${showHand(game.d)}\n\n${head}\nWallet: 💰${fmt(u.coins)}`
}

// ---------------------------------------------------------------- the commands
module.exports = [
  // ---- old profile / activity commands kept
  {
    name: 'rank',
    aliases: ['level', 'xp', 'profile'],
    desc: 'Your level, XP and coins',
    category: 'fun',
    async run(sock, m) {
      const who = target(m) || m.sender
      const num = numOf(who)
      const u = levels.user(num)
      const lvl = levels.levelOf(u.xp)
      const next = levels.xpForLevel(lvl + 1)
      const sorted = Object.entries(store.get().users).sort((a, b) => b[1].xp - a[1].xp)
      const pos = sorted.findIndex(([id]) => id === num) + 1
      await m.reply(`@${num}\nLevel ${lvl}\nXP ${fmt(u.xp)} / ${fmt(next)}\nCoins ${fmt(u.coins)}\nMessages ${fmt(u.msgs)}\nGlobal rank #${pos}`, { mentions: [who] })
    }
  },
  {
    name: 'top',
    desc: 'Top 10 most active members of this group',
    category: 'fun',
    group: true,
    async run(sock, m) {
      const gx = store.get().gxp?.[m.chat] || {}
      const top = Object.entries(gx).sort((a, b) => b[1] - a[1]).slice(0, 10)
      if (!top.length) return m.reply('No activity recorded here yet. Start chatting.')
      const lines = top.map(([id, xp], i) => `${i + 1}. @${id} • level ${levels.levelOf(xp)} • ${fmt(xp)} xp`)
      await m.reply(`Top members\n\n${lines.join('\n')}`, { mentions: top.map(([id]) => `${id}@s.whatsapp.net`) })
    }
  },
  {
    name: 'levelup',
    desc: 'Announce level ups in this group on/off',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { args }) {
      const mode = (args[0] || '').toLowerCase()
      const db = store.get()
      if (!['on', 'off'].includes(mode)) return m.reply('Example: .levelup on | off')
      db.levelup = db.levelup || {}
      if (mode === 'on') db.levelup[m.chat] = true
      else delete db.levelup[m.chat]
      store.save()
      await m.reply(`Level-up messages ${mode}.`)
    }
  },

  // ================================================================ EARN
  cmd(
    'balance',
    'Show wallet, bank, total and loan',
    async (sock, m) => {
      const t = target(m)
      const { num, u, e } = t ? { num: numOf(t), u: levels.user(numOf(t)), e: ecoOf(numOf(t)) } : await acct(m)
      await m.reply(
        `💳 *BALANCE* @${num}\n\n👛 Wallet: 💰${fmt(u.coins)}\n🏦 Bank: 💰${fmt(e.bank)}\n📊 Total: 💰${fmt(u.coins + e.bank)}\n💸 Loan: 💰${fmt(e.loan)}` +
          (inJail(e) ? `\n🔒 In jail: ${left(e.jailUntil - Date.now())}` : ''),
        { mentions: [t || m.sender] }
      )
    },
    { aliases: ['bal', 'wallet', 'coins'] }
  ),
  earn('daily', 'Claim 500 coins every 24h', DAY, ({ u }) => {
    u.coins += 500
    return `🎁 Daily claimed: +💰500\nWallet: 💰${fmt(u.coins)}`
  }),
  earn('weekly', 'Claim 3000 coins every 7 days', 7 * DAY, ({ u }) => {
    u.coins += 3000
    return `🎉 Weekly claimed: +💰3,000\nWallet: 💰${fmt(u.coins)}`
  }),
  earn(
    'work',
    'Work for coins (10 min cooldown)',
    10 * MIN,
    ({ u, e }) => {
      const job = JOBS[e.job]
      const gain = job ? rand(job.min, job.max) : rand(100, 300)
      u.coins += gain
      return `💼 You ${job ? `worked as a ${job.name}` : pick(WORKS)} and earned 💰${fmt(gain)}\nWallet: 💰${fmt(u.coins)}`
    }
  ),
  earn('overtime', 'Overtime pay 300-600 (30% fall sick)', HOUR, ({ u }) => {
    if (chance(0.3)) {
      const lost = take(u, 200)
      return `🤒 You fell sick from overtime and paid 💰${fmt(lost)} in hospital bills.\nWallet: 💰${fmt(u.coins)}`
    }
    const gain = rand(300, 600)
    u.coins += gain
    return `🌙 Overtime paid off: +💰${fmt(gain)}\nWallet: 💰${fmt(u.coins)}`
  }),
  earn('beg', 'Beg for coins (50% chance)', 5 * MIN, ({ u }) => {
    if (!chance(0.5)) return '🥺 Nobody gave you anything. Try again later.'
    const gain = rand(10, 100)
    u.coins += gain
    return `🙏 A kind stranger gave you 💰${fmt(gain)}\nWallet: 💰${fmt(u.coins)}`
  }),
  earn('hustle', 'Random hustle 50-400', 15 * MIN, ({ u }) => {
    const gain = rand(50, 400)
    u.coins += gain
    return `🏃 You ${pick(HUSTLES)} and made 💰${fmt(gain)}\nWallet: 💰${fmt(u.coins)}`
  }),
  cmd('job', 'List jobs or pick one: .job driver', async (sock, m, { args }) => {
    const { u, e } = await acct(m)
    const q = (args[0] || '').toLowerCase()
    if (!q) {
      const list = Object.values(JOBS).map((j) => `• ${j.name}: 💰${j.min}-${j.max} per .work`).join('\n')
      return m.reply(`💼 *JOBS*\n\n${list}\n\nYour job: ${JOBS[e.job]?.name || 'none (100-300)'}\nPick one: .job <name>`)
    }
    const key = Object.keys(JOBS).find((k) => k.startsWith(q) || JOBS[k].name.toLowerCase() === q)
    if (!key) return m.reply('Unknown job. Use .job to see the list.')
    e.job = key
    store.save()
    await m.reply(`✅ You are now a ${JOBS[key].name}. Use .work to earn 💰${JOBS[key].min}-${JOBS[key].max}.`)
  }),
  earn('mine', 'Mine for coins 0-500 (20% cave-in)', 20 * MIN, ({ u, e }) => {
    if (chance(0.2)) {
      const lost = take(u, 100)
      return `🪨 Cave-in! You lost 💰${fmt(lost)} fixing your gear.\nWallet: 💰${fmt(u.coins)}`
    }
    let gain = rand(0, 500)
    const boosted = boostOn(e, 'pickaxe')
    if (boosted) gain *= 2
    u.coins += gain
    return `⛏️ You mined 💰${fmt(gain)}${boosted ? ' (Pickaxe x2)' : ''}\nWallet: 💰${fmt(u.coins)}`
  }),
  earn('fish', 'Go fishing', 15 * MIN, ({ u, e }) => {
    const roll = Math.random()
    let gain = roll < 0.3 ? 0 : roll < 0.75 ? rand(50, 150) : rand(200, 400)
    const boosted = boostOn(e, 'fishingrod') && gain > 0
    if (boosted) gain *= 2
    u.coins += gain
    if (!gain) return '🎣 You caught an old boot. Nothing earned.'
    return `🎣 You caught fish worth 💰${fmt(gain)}${boosted ? ' (Rod x2)' : ''}\nWallet: 💰${fmt(u.coins)}`
  }),
  earn('farm', 'Farm 80-300 (10% bad harvest)', 20 * MIN, ({ u }) => {
    if (chance(0.1)) return '🌾 Your crops failed this time. Nothing earned.'
    const gain = rand(80, 300)
    u.coins += gain
    return `🌽 You sold your harvest for 💰${fmt(gain)}\nWallet: 💰${fmt(u.coins)}`
  }),
  earn('hunt', 'Hunt: 60% win 100-400, 40% lose 100', 20 * MIN, ({ u }) => {
    if (chance(0.6)) {
      const gain = rand(100, 400)
      u.coins += gain
      return `🏹 Great hunt! You earned 💰${fmt(gain)}\nWallet: 💰${fmt(u.coins)}`
    }
    const lost = take(u, 100)
    return `🐗 The animal got away and damaged your gear: -💰${fmt(lost)}\nWallet: 💰${fmt(u.coins)}`
  }),
  cmd('crypto', 'Gideon coin market: .crypto buy/sell <amount>', async (sock, m, { args }) => {
    const { u, e } = await acct(m)
    const c = market()
    const price = Math.max(1, Math.round(c.price * 100) / 100)
    const sub = (args[0] || '').toLowerCase()
    if (sub === 'buy' || sub === 'sell') {
      const units = sub === 'sell' ? parseAmt(args[1], e.crypto) : parseAmt(args[1], Math.floor(u.coins / price))
      if (!units || units < 1) return m.reply(`Example: .crypto ${sub} 5 (units of GDN)`)
      if (sub === 'buy') {
        const cost = Math.ceil(price * units)
        if (cost > u.coins) return m.reply(`You need 💰${fmt(cost)} for ${fmt(units)} GDN. You have 💰${fmt(u.coins)}.`)
        u.coins -= cost
        e.crypto += units
        store.save()
        return m.reply(`📈 Bought ${fmt(units)} GDN for 💰${fmt(cost)} (price ${price.toFixed(2)})\nHoldings: ${fmt(e.crypto)} GDN`)
      }
      if (units > e.crypto) return m.reply(`You only hold ${fmt(e.crypto)} GDN.`)
      const gain = Math.floor(price * units)
      u.coins += gain
      e.crypto -= units
      store.save()
      return m.reply(`📉 Sold ${fmt(units)} GDN for 💰${fmt(gain)} (price ${price.toFixed(2)})\nHoldings: ${fmt(e.crypto)} GDN`)
    }
    const arrow = c.change > 0 ? '📈' : c.change < 0 ? '📉' : '➖'
    await m.reply(
      `🪙 *GIDEON COIN (GDN)*\n\nPrice: 💰${price.toFixed(2)} ${arrow} ${c.change >= 0 ? '+' : ''}${c.change.toFixed(1)}%\nYour holdings: ${fmt(e.crypto)} GDN (💰${fmt(price * e.crypto)})\n\nPrice moves -20% to +20% every 5 min.\n.crypto buy <amount> • .crypto sell <amount|all>`
    )
  }),
  cmd('invest', 'Invest coins (min 100), claim after 1h with .claim', async (sock, m, { args }) => {
    const { u, e } = await acct(m)
    if (e.invest) {
      const wait = e.invest.at + HOUR - Date.now()
      return m.reply(`📊 You already invested 💰${fmt(e.invest.amount)}. ${wait > 0 ? `Ready in ${left(wait)}.` : 'Ready! Use .claim'}`)
    }
    const amount = parseAmt(args[0], u.coins)
    if (!amount || amount < 100) return m.reply('Example: .invest 500 (minimum 100)')
    if (amount > u.coins) return m.reply(`You only have 💰${fmt(u.coins)}.`)
    u.coins -= amount
    e.invest = { amount, at: Date.now() }
    store.save()
    await m.reply(`📊 Invested 💰${fmt(amount)}. Come back in 1 hour and use .claim (profit between -20% and +50%).`)
  }),
  cmd('claim', 'Claim your finished investment', async (sock, m) => {
    const { u, e } = await acct(m)
    if (!e.invest) return m.reply('You have no active investment. Use .invest <amount>')
    const wait = e.invest.at + HOUR - Date.now()
    if (wait > 0) return m.reply(`⏳ Your investment is not ready. ${left(wait)} left.`)
    const pct = rand(-200, 500) / 1000
    const payout = Math.floor(e.invest.amount * (1 + pct))
    const base = e.invest.amount
    u.coins += payout
    e.invest = null
    store.save()
    await m.reply(`${pct >= 0 ? '📈' : '📉'} Investment result: ${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%\n💰${fmt(base)} → 💰${fmt(payout)}\nWallet: 💰${fmt(u.coins)}`)
  }),

  // ================================================================ BANK
  cmd(
    'bank',
    'Show bank, wallet and loan',
    async (sock, m) => {
      const { u, e } = await acct(m)
      await m.reply(`🏦 *BANK*\n\nBank: 💰${fmt(e.bank)} (safe from robbers)\nWallet: 💰${fmt(u.coins)}\nLoan: 💰${fmt(e.loan)}${e.loan ? `\nDue in: ${left(e.loanDue - Date.now())}` : ''}\n\n.deposit <amount|all> • .withdraw <amount|all>`)
    }
  ),
  cmd(
    'deposit',
    'Wallet to bank: .deposit 500 / all',
    async (sock, m, { args }) => {
      const { u, e } = await acct(m)
      const amt = parseAmt(args[0], u.coins)
      if (!amt || amt < 1) return m.reply('Example: .deposit 500 or .deposit all')
      if (amt > u.coins) return m.reply(`You only have 💰${fmt(u.coins)} in your wallet.`)
      u.coins -= amt
      e.bank += amt
      store.save()
      await m.reply(`🏦 Deposited 💰${fmt(amt)}\nWallet: 💰${fmt(u.coins)} • Bank: 💰${fmt(e.bank)}`)
    },
    { aliases: ['dep'] }
  ),
  cmd(
    'withdraw',
    'Bank to wallet: .withdraw 500 / all',
    async (sock, m, { args }) => {
      const { u, e } = await acct(m)
      const amt = parseAmt(args[0], e.bank)
      if (!amt || amt < 1) return m.reply('Example: .withdraw 500 or .withdraw all')
      if (amt > e.bank) return m.reply(`You only have 💰${fmt(e.bank)} in the bank.`)
      e.bank -= amt
      u.coins += amt
      store.save()
      await m.reply(`👛 Withdrew 💰${fmt(amt)}\nWallet: 💰${fmt(u.coins)} • Bank: 💰${fmt(e.bank)}`)
    },
    { aliases: ['with'] }
  ),
  cmd(
    'transfer',
    'Send coins from wallet: .transfer @user 100',
    async (sock, m, { args }) => {
      const { num, u } = await acct(m)
      const to = target(m)
      const amt = parseAmt(args.find((a) => /^\d|^all$|^half$/i.test(a)), u.coins)
      if (!to || !amt) return m.reply('Example: .transfer @user 100 (or reply with .transfer 100)')
      if (numOf(to) === num) return m.reply("You can't send coins to yourself.")
      if (amt < 10) return m.reply('Minimum transfer is 💰10.')
      if (amt > u.coins) return m.reply(`You only have 💰${fmt(u.coins)} in your wallet.`)
      u.coins -= amt
      levels.user(numOf(to)).coins += amt
      store.save()
      await m.reply(`💸 Sent 💰${fmt(amt)} to @${numOf(to)}\nYour wallet: 💰${fmt(u.coins)}`, { mentions: [to] })
    },
    { aliases: ['give', 'pay'] }
  ),
  cmd('gift', 'Gift coins and announce it: .gift @user 100', async (sock, m, { args }) => {
    const { num, u } = await acct(m)
    const to = target(m)
    const amt = parseAmt(args.find((a) => /^\d|^all$|^half$/i.test(a)), u.coins)
    if (!to || !amt) return m.reply('Example: .gift @user 100')
    if (numOf(to) === num) return m.reply("You can't gift yourself.")
    if (amt < 10) return m.reply('Minimum gift is 💰10.')
    if (amt > u.coins) return m.reply(`You only have 💰${fmt(u.coins)} in your wallet.`)
    u.coins -= amt
    levels.user(numOf(to)).coins += amt
    store.save()
    await sock.sendMessage(
      m.chat,
      { text: `🎁 *GIFT ALERT* 🎁\n\n@${num} just gifted 💰${fmt(amt)} to @${numOf(to)}!\nWhat a legend 👏`, mentions: [m.sender, to] },
      { quoted: m._msg }
    )
  }),
  cmd('loan', 'Borrow up to 2000 (10% interest)', async (sock, m, { args }) => {
    const { u, e } = await acct(m)
    if (e.loan > 0) return m.reply(`💸 You already have a loan of 💰${fmt(e.loan)}. Pay it with .payloan <amount> (due in ${left(e.loanDue - Date.now())}).`)
    const amt = parseAmt(args[0], 2000)
    if (!amt || amt < 1) return m.reply('Example: .loan 1500 (max 2000, you repay 110%, due in 24h or you go to jail)')
    if (amt > 2000) return m.reply('The maximum loan is 💰2,000.')
    e.loan = Math.ceil(amt * 1.1)
    e.loanDue = Date.now() + DAY
    u.coins += amt
    store.save()
    await m.reply(`🏦 Loan approved: +💰${fmt(amt)} to your wallet.\nYou owe 💰${fmt(e.loan)} (10% interest). Pay within 24h or you go to jail 10 min.`)
  }),
  cmd('payloan', 'Pay back your loan: .payloan 500 / all', async (sock, m, { args }) => {
    const { u, e } = await acct(m)
    if (!e.loan) return m.reply('You have no loan.')
    const amt = parseAmt(args[0], Math.min(e.loan, u.coins))
    if (!amt || amt < 1) return m.reply(`You owe 💰${fmt(e.loan)}. Example: .payloan 500 or .payloan all`)
    if (amt > u.coins) return m.reply(`You only have 💰${fmt(u.coins)} in your wallet.`)
    const pay = Math.min(amt, e.loan)
    u.coins -= pay
    e.loan -= pay
    if (!e.loan) e.loanDue = 0
    store.save()
    await m.reply(e.loan ? `✅ Paid 💰${fmt(pay)}. Still owing 💰${fmt(e.loan)}.` : `✅ Loan fully paid. You are debt free! 🎉`)
  }),

  // ================================================================ SHOP
  cmd('shop', 'Show the item shop', async (sock, m) => {
    const lines = Object.values(ITEMS).map((i) => `${i.emoji} ${i.name} — 💰${fmt(i.price)}`)
    await m.reply(
      `🛒 *SHOP*\n\n${lines.join('\n')}\n\n.buy <item> • .sell <item> (50% back)\n.use <item> • .inventory\n\n🏢 Business: .buy business <type>`
    )
  }),
  cmd('buy', 'Buy an item: .buy shield | .buy business mama put', async (sock, m, { args }) => {
    const { u, e } = await acct(m)
    if ((args[0] || '').toLowerCase() === 'business') {
      if (e.biz) return m.reply(`You already own a ${BIZ[e.biz.type].name}. One business per person.`)
      const key = findBiz(args.slice(1).join(' '))
      if (!key) {
        const list = Object.values(BIZ).map((b) => `• ${b.name} — 💰${fmt(b.price)}`).join('\n')
        return m.reply(`🏢 *BUSINESSES*\n\n${list}\n\nExample: .buy business mama put`)
      }
      const b = BIZ[key]
      if (u.coins < b.price) return m.reply(`You need 💰${fmt(b.price)} for a ${b.name}. You have 💰${fmt(u.coins)}.`)
      u.coins -= b.price
      e.biz = { type: key, level: 1, lastCollect: Date.now() }
      store.save()
      return m.reply(`🏢 You bought a *${b.name}*!\nEarns 💰${fmt(bizHourly(e.biz))}/hour. Use .collect and .upgrade`)
    }
    const key = findItem(args.join(' '))
    if (!key) return m.reply('Unknown item. Use .shop to see what is for sale.')
    const it = ITEMS[key]
    if (u.coins < it.price) return m.reply(`You need 💰${fmt(it.price)} for a ${it.name}. You have 💰${fmt(u.coins)}.`)
    u.coins -= it.price
    e.inv[key] = (e.inv[key] || 0) + 1
    store.save()
    await m.reply(`${it.emoji} Bought 1 ${it.name} for 💰${fmt(it.price)}\nWallet: 💰${fmt(u.coins)}`)
  }),
  cmd('sell', 'Sell an item for 50% of its price', async (sock, m, { args }) => {
    const { u, e } = await acct(m)
    const key = findItem(args.join(' '))
    if (!key) return m.reply('Example: .sell shield')
    if (!e.inv[key]) return m.reply(`You don't own a ${ITEMS[key].name}.`)
    const gain = Math.floor(ITEMS[key].price / 2)
    e.inv[key]--
    if (!e.inv[key]) delete e.inv[key]
    u.coins += gain
    store.save()
    await m.reply(`💰 Sold ${ITEMS[key].name} for 💰${fmt(gain)}\nWallet: 💰${fmt(u.coins)}`)
  }),
  cmd(
    'inventory',
    'Show your items',
    async (sock, m) => {
      const { e } = await acct(m)
      const items = Object.entries(e.inv).filter(([, n]) => n > 0)
      const active = []
      if (e.boost.shield) active.push('🛡️ Shield armed')
      if (e.boost.fakeid) active.push('🪪 Fake ID armed')
      for (const [k, label] of [['luckycharm', '🍀 Lucky Charm'], ['pickaxe', '⛏️ Pickaxe x2'], ['fishingrod', '🎣 Rod x2']]) {
        if (boostOn(e, k)) active.push(`${label} (${left(e.boost[k] - Date.now())})`)
      }
      const list = items.length ? items.map(([k, n]) => `${ITEMS[k].emoji} ${ITEMS[k].name} x${n}`).join('\n') : 'Empty. Visit .shop'
      await m.reply(`🎒 *INVENTORY*\n\n${list}${active.length ? `\n\n*Active*\n${active.join('\n')}` : ''}`)
    },
    { aliases: ['inv', 'bag'] }
  ),
  cmd('use', 'Use an item: .use shield', async (sock, m, { args }) => {
    const { e } = await acct(m)
    const key = findItem(args.join(' '))
    if (!key) return m.reply('Example: .use shield')
    if (!e.inv[key]) return m.reply(`You don't own a ${ITEMS[key].name}. Buy one with .buy ${ITEMS[key].name.toLowerCase()}`)
    const it = ITEMS[key]
    let msg
    if (key === 'shield') {
      if (e.boost.shield) return m.reply('Your shield is already armed.')
      e.boost.shield = true
      msg = '🛡️ Shield armed. It will block the next robbery against you.'
    } else if (key === 'luckycharm') {
      e.boost.luckycharm = Date.now() + HOUR
      msg = '🍀 Lucky Charm active for 1 hour: +10% win chance on gamble, roulette and coinflipbet.'
    } else if (key === 'pickaxe') {
      e.boost.pickaxe = Date.now() + HOUR
      msg = '⛏️ Pickaxe active for 1 hour: .mine pays double.'
    } else if (key === 'fishingrod') {
      e.boost.fishingrod = Date.now() + HOUR
      msg = '🎣 Fishing Rod active for 1 hour: .fish pays double.'
    } else if (key === 'energydrink') {
      delete e.cd.work
      msg = '⚡ Energy Drink: your work cooldown is cleared. Use .work now!'
    } else if (key === 'fakeid') {
      if (e.boost.fakeid) return m.reply('Your Fake ID is already armed.')
      e.boost.fakeid = true
      msg = '🪪 Fake ID armed. Your next jail time is cut in half.'
    } else {
      return m.reply(`${it.emoji} ${it.name} is a collectible. Keep it as a flex or .sell it for 50%.`)
    }
    e.inv[key]--
    if (!e.inv[key]) delete e.inv[key]
    store.save()
    await m.reply(msg)
  }),
  cmd('trade', 'Trade an item: .trade @user shield [price] | .trade accept', async (sock, m, { args }) => {
    const { num, e } = await acct(m)
    const sub = (args[0] || '').toLowerCase()
    if (sub === 'accept' || sub === 'decline') {
      const offer = trades.get(num)
      if (!offer || Date.now() - offer.at > 2 * MIN) return m.reply('You have no pending trade offer.')
      trades.delete(num)
      if (sub === 'decline') return m.reply('❌ Trade declined.')
      const from = ecoOf(offer.from)
      const fromUser = levels.user(offer.from)
      const me = levels.user(num)
      if (!from.inv[offer.item]) return m.reply('The other person no longer has that item.')
      if (me.coins < offer.price) return m.reply(`You need 💰${fmt(offer.price)} for this trade.`)
      me.coins -= offer.price
      fromUser.coins += offer.price
      from.inv[offer.item]--
      if (!from.inv[offer.item]) delete from.inv[offer.item]
      e.inv[offer.item] = (e.inv[offer.item] || 0) + 1
      store.save()
      return m.reply(`🤝 Trade done! You received ${ITEMS[offer.item].name}${offer.price ? ` for 💰${fmt(offer.price)}` : ''}.`)
    }
    const to = target(m)
    const rest = args.filter((a) => !a.startsWith('@'))
    const key = findItem(rest.filter((a) => !/^\d+$/.test(a)).join(' '))
    const price = parseInt(rest.find((a) => /^\d+$/.test(a)) || '0', 10)
    if (!to || !key) return m.reply('Example: .trade @user shield (free) or .trade @user shield 500 (they pay 500)')
    if (numOf(to) === num) return m.reply("You can't trade with yourself.")
    if (!e.inv[key]) return m.reply(`You don't own a ${ITEMS[key].name}.`)
    trades.set(numOf(to), { from: num, item: key, price, at: Date.now() })
    await m.reply(`🤝 @${numOf(to)}, @${num} offers you ${ITEMS[key].emoji} ${ITEMS[key].name}${price ? ` for 💰${fmt(price)}` : ' for free'}.\nReply with .trade accept or .trade decline (2 min).`, { mentions: [to, m.sender] })
  }),

  // ================================================================ CRIME
  cmd('rob', 'Rob a user\'s wallet: .rob @user', async (sock, m) => {
    const { num, u, e } = await acct(m)
    if (await jailed(m, e)) return
    const to = target(m)
    if (!to) return m.reply('Tag or reply to the person you want to rob.')
    if (numOf(to) === num) return m.reply("You can't rob yourself.")
    const vu = levels.user(numOf(to))
    const ve = eco(vu)
    if (inJail(ve)) return m.reply('🔒 You cannot rob someone who is in jail.')
    if (await onCd(m, e, 'rob', 30 * MIN)) return
    if (ve.boost.shield) {
      delete ve.boost.shield
      store.save()
      return m.reply(`🛡️ @${numOf(to)}'s Shield blocked your robbery and broke!`, { mentions: [to] })
    }
    if (vu.coins < 1) return m.reply(`@${numOf(to)} has nothing in their wallet. (Bank money is safe!)`, { mentions: [to] })
    if (chance(0.5)) {
      const amt = Math.max(1, Math.floor(vu.coins * (rand(10, 30) / 100)))
      vu.coins -= amt
      u.coins += amt
      lastRob.set(m.chat, { robber: num, victim: numOf(to), victimJid: to, amount: amt, at: Date.now(), checked: false })
      store.save()
      return m.reply(`🦹 You robbed @${numOf(to)} and escaped with 💰${fmt(amt)}!\nWallet: 💰${fmt(u.coins)}`, { mentions: [to] })
    }
    const fine = take(u, 200)
    const ms = jailUser(e, 5 * MIN)
    store.save()
    await m.reply(`🚔 You got caught! Fine: 💰${fmt(fine)} and ${left(ms)} in jail.`)
  }),
  cmd('heist', 'Start a heist (3+ people): .heist then .heist join', async (sock, m, { args }) => {
    if (!m.isGroup) return m.reply('Heists are for groups.')
    const { num, e } = await acct(m)
    if (await jailed(m, e)) return
    const sub = (args[0] || '').toLowerCase()
    const h = heists.get(m.chat)
    if (sub === 'join') {
      if (!h) return m.reply('No heist is being planned. Start one with .heist')
      if (h.members.has(num)) return m.reply('You already joined this heist.')
      h.members.set(num, m.sender)
      return m.reply(`🕶️ @${num} joined the heist! (${h.members.size}/3 needed)`, { mentions: [m.sender] })
    }
    if (h) return m.reply(`A heist is already planned. ${h.members.size}/3 joined. Use .heist join`)
    const state = { members: new Map([[num, m.sender]]) }
    heists.set(m.chat, state)
    state.timer = setTimeout(async () => {
      heists.delete(m.chat)
      try {
        const ids = [...state.members.keys()]
        const jids = [...state.members.values()]
        if (ids.length < 3) return sock.sendMessage(m.chat, { text: `🚫 Heist cancelled. Only ${ids.length}/3 people joined.` })
        const tag = ids.map((i) => `@${i}`).join(' ')
        if (chance(0.6)) {
          const total = rand(1500, 3000)
          const share = Math.floor(total / ids.length)
          for (const id of ids) levels.user(id).coins += share
          store.save()
          await sock.sendMessage(m.chat, { text: `💎 *HEIST SUCCESS!*\n${tag}\n\nThe crew stole 💰${fmt(total)}. Each member gets 💰${fmt(share)}!`, mentions: jids })
        } else {
          for (const id of ids) jailUser(ecoOf(id), 10 * MIN)
          store.save()
          await sock.sendMessage(m.chat, { text: `🚔 *HEIST FAILED!*\n${tag}\n\nThe police caught everyone. All jailed for 10 minutes.`, mentions: jids })
        }
      } catch {}
    }, 2 * MIN)
    await m.reply(`🕶️ *HEIST PLANNED* by @${num}\n\nNeed 3 people in total. Join with *.heist join* in the next 2 minutes!\n60% success, loot 💰1,500-3,000 split between everyone. 40% fail: everyone jailed 10 min.`, { mentions: [m.sender] })
  }),
  cmd('steal', 'Steal a random item: .steal @user', async (sock, m) => {
    const { num, e } = await acct(m)
    if (await jailed(m, e)) return
    const to = target(m)
    if (!to) return m.reply('Tag or reply to the person you want to steal from.')
    if (numOf(to) === num) return m.reply("You can't steal from yourself.")
    const ve = ecoOf(numOf(to))
    const items = Object.entries(ve.inv).filter(([, n]) => n > 0)
    if (!items.length) return m.reply(`@${numOf(to)} has no items worth stealing.`, { mentions: [to] })
    if (await onCd(m, e, 'steal', HOUR)) return
    if (chance(0.4)) {
      const [key] = pick(items)
      ve.inv[key]--
      if (!ve.inv[key]) delete ve.inv[key]
      e.inv[key] = (e.inv[key] || 0) + 1
      store.save()
      return m.reply(`🥷 You stole a ${ITEMS[key].emoji} ${ITEMS[key].name} from @${numOf(to)}!`, { mentions: [to] })
    }
    const ms = jailUser(e, 5 * MIN)
    store.save()
    await m.reply(`🚔 You got caught stealing! Jailed for ${left(ms)}.`)
  }),
  cmd('scam', 'Scam a user: .scam @user', async (sock, m) => {
    const { num, u, e } = await acct(m)
    if (await jailed(m, e)) return
    const to = target(m)
    if (!to) return m.reply('Tag or reply to the person you want to scam.')
    if (numOf(to) === num) return m.reply("You can't scam yourself.")
    const vu = levels.user(numOf(to))
    if (vu.coins < 1) return m.reply(`@${numOf(to)} has an empty wallet, nothing to scam.`, { mentions: [to] })
    if (await onCd(m, e, 'scam', 20 * MIN)) return
    if (chance(0.5)) {
      const amt = Math.min(rand(200, 500), vu.coins)
      vu.coins -= amt
      u.coins += amt
      store.save()
      return m.reply(`🎭 Scam successful! @${numOf(to)} sent you 💰${fmt(amt)}.\nWallet: 💰${fmt(u.coins)}`, { mentions: [to] })
    }
    const lost = take(u, 500)
    const ms = jailUser(e, 10 * MIN)
    store.save()
    await m.reply(`🚔 The scam backfired! You lost 💰${fmt(lost)} and got ${left(ms)} in jail.`)
  }),
  cmd('jail', 'See who is in jail', async (sock, m) => {
    const users = store.get().users || {}
    let ids = Object.keys(users).filter((id) => (users[id].eco?.jailUntil || 0) > Date.now())
    if (m.isGroup) {
      const meta = await sock.groupMetadata(m.chat)
      const members = new Set(meta.participants.flatMap((p) => [p.phoneNumber, p.id, p.lid, p.jid]).filter(Boolean).map(numOf))
      ids = ids.filter((id) => members.has(id))
    }
    if (!ids.length) return m.reply('🔓 Nobody is in jail right now.')
    const lines = ids.map((id) => `🔒 @${id} — ${left(users[id].eco.jailUntil - Date.now())}`)
    await m.reply(`⛓️ *JAIL*\n\n${lines.join('\n')}\n\nFree someone with .bail @user (💰500)`, { mentions: ids.map(fn.toJid) })
  }),
  cmd('bail', 'Pay 500 to free someone: .bail @user', async (sock, m) => {
    const { num, u } = await acct(m)
    const to = target(m)
    if (!to) return m.reply('Tag or reply to the person you want to bail out.')
    if (numOf(to) === num) return m.reply('You cannot bail yourself out, you need a friend.')
    const ve = ecoOf(numOf(to))
    if (!inJail(ve)) return m.reply(`@${numOf(to)} is not in jail.`, { mentions: [to] })
    if (u.coins < 500) return m.reply(`Bail costs 💰500. You have 💰${fmt(u.coins)}.`)
    u.coins -= 500
    ve.jailUntil = 0
    store.save()
    await m.reply(`🔓 You paid 💰500 and freed @${numOf(to)}!`, { mentions: [to] })
  }),
  cmd('police', 'Call the police on the last robber (10 min window)', async (sock, m) => {
    const { num } = await acct(m)
    const rec = lastRob.get(m.chat)
    if (!rec || Date.now() - rec.at > 10 * MIN) return m.reply('🚓 No robbery was reported in the last 10 minutes.')
    if (rec.robber === num) return m.reply('🚓 Calling the police on yourself? Nice try.')
    if (rec.checked) return m.reply('🚓 The police already investigated that case.')
    rec.checked = true
    if (!chance(0.5)) return m.reply('🚓 The police searched but found no evidence. The robber got away!')
    const ru = levels.user(rec.robber)
    const re = eco(ru)
    const back = take(ru, rec.amount)
    levels.user(rec.victim).coins += back
    const ms = jailUser(re, 15 * MIN)
    store.save()
    await sock.sendMessage(
      m.chat,
      { text: `🚓 *ROBBER CAUGHT!*\n@${rec.robber} lost 💰${fmt(back)} (returned to @${rec.victim}) and is jailed for ${left(ms)}.`, mentions: [fn.toJid(rec.robber), fn.toJid(rec.victim)] },
      { quoted: m._msg }
    )
  }),

  // ================================================================ GAMBLE
  cmd(
    'gamble',
    'Gamble: 50% to double (min 50, max 5000)',
    async (sock, m, { args }) => {
      const { u, e } = await acct(m)
      const bet = parseAmt(args[0], Math.min(u.coins, MAX_BET))
      if (!bet || bet < MIN_BET) return m.reply(`Example: .gamble 500 (min ${MIN_BET}, max ${fmt(MAX_BET)})`)
      if (bet > MAX_BET) return m.reply(`Maximum bet is 💰${fmt(MAX_BET)}.`)
      if (bet > u.coins) return m.reply(`You only have 💰${fmt(u.coins)}.`)
      const p = boostOn(e, 'luckycharm') ? 0.6 : 0.5
      const win = chance(p)
      u.coins += win ? bet : -bet
      store.save()
      await m.reply(win ? `🎲 You won 💰${fmt(bet)}!${p > 0.5 ? ' 🍀' : ''}\nWallet: 💰${fmt(u.coins)}` : `🎲 You lost 💰${fmt(bet)}.\nWallet: 💰${fmt(u.coins)}`)
    },
    { aliases: ['bet'] }
  ),
  cmd('slots', 'Slot machine (100 per spin)', async (sock, m) => {
    const { u } = await acct(m)
    if (u.coins < 100) return m.reply('A spin costs 💰100.')
    u.coins -= 100
    const icons = ['🍒', '🍋', '🍇', '7️⃣', '⭐', '🔔']
    const r = [pick(icons), pick(icons), pick(icons)]
    const same = new Set(r).size
    let prize = 0
    let msg = '😔 No match. You lose 💰100.'
    if (same === 1) {
      prize = 1000
      msg = '🎉 JACKPOT! 3 of a kind!'
    } else if (same === 2) {
      prize = 200
      msg = '✨ 2 of a kind!'
    }
    u.coins += prize
    store.save()
    await m.reply(`🎰 [ ${r.join(' | ')} ]\n\n${msg}${prize ? ` You win 💰${fmt(prize)}` : ''}\nWallet: 💰${fmt(u.coins)}`)
  }),
  cmd('roulette', 'Roulette: .roulette red 500 (48% to double)', async (sock, m, { args }) => {
    const { u, e } = await acct(m)
    const color = (args[0] || '').toLowerCase()
    const bet = parseAmt(args[1], Math.min(u.coins, MAX_BET))
    if (!['red', 'black'].includes(color) || !bet || bet < MIN_BET) return m.reply(`Example: .roulette red 500 (min ${MIN_BET}, max ${fmt(MAX_BET)})`)
    if (bet > MAX_BET) return m.reply(`Maximum bet is 💰${fmt(MAX_BET)}.`)
    if (bet > u.coins) return m.reply(`You only have 💰${fmt(u.coins)}.`)
    const p = boostOn(e, 'luckycharm') ? 0.58 : 0.48
    const win = chance(p)
    const landed = win ? color : color === 'red' ? 'black' : 'red'
    u.coins += win ? bet : -bet
    store.save()
    await m.reply(`🎡 The ball landed on ${landed === 'red' ? '🔴 red' : '⚫ black'}!\n${win ? `You won 💰${fmt(bet)}` : `You lost 💰${fmt(bet)}`}\nWallet: 💰${fmt(u.coins)}`)
  }),
  cmd(
    'blackjack',
    'Blackjack vs the bot: .blackjack 500, then .hit / .stand',
    async (sock, m, { args }) => {
      const { num, u } = await acct(m)
      const sub = (args[0] || '').toLowerCase()
      const game = bjGames.get(num)
      if (sub === 'hit' || sub === 'stand') {
        if (!game) return m.reply('You have no blackjack game. Start with .blackjack <amount>')
        if (sub === 'hit') {
          game.p.push(game.deck.pop())
          if (handValue(game.p) > 21) return m.reply(settleBj(num, game))
          if (handValue(game.p) === 21) return m.reply(settleBj(num, game))
          return m.reply(`🃏 *BLACKJACK*\nYou: ${showHand(game.p)}\nDealer: ${game.d[0].r}${game.d[0].s} ❓\n\n.hit or .stand`)
        }
        return m.reply(settleBj(num, game))
      }
      if (game) return m.reply(`You are already playing.\nYou: ${showHand(game.p)}\nDealer: ${game.d[0].r}${game.d[0].s} ❓\n\n.hit or .stand`)
      const bet = parseAmt(args[0], Math.min(u.coins, MAX_BET))
      if (!bet || bet < MIN_BET) return m.reply(`Example: .blackjack 500 (min ${MIN_BET}, max ${fmt(MAX_BET)})`)
      if (bet > MAX_BET) return m.reply(`Maximum bet is 💰${fmt(MAX_BET)}.`)
      if (bet > u.coins) return m.reply(`You only have 💰${fmt(u.coins)}.`)
      u.coins -= bet
      const d = deck()
      const g = { bet, deck: d, p: [d.pop(), d.pop()], d: [d.pop(), d.pop()] }
      bjGames.set(num, g)
      g.timer = setTimeout(() => {
        if (bjGames.get(num) === g) sock.sendMessage(m.chat, { text: `⏰ @${num} took too long. Auto-stand:\n\n${settleBj(num, g)}`, mentions: [m.sender] }).catch(() => {})
      }, 2 * MIN)
      store.save()
      if (handValue(g.p) === 21) return m.reply(`✨ Natural 21!\n${settleBj(num, g)}`)
      await m.reply(`🃏 *BLACKJACK* (bet 💰${fmt(bet)})\nYou: ${showHand(g.p)}\nDealer: ${g.d[0].r}${g.d[0].s} ❓\n\n.hit or .stand`)
    },
    { aliases: ['bj'] }
  ),
  cmd('hit', 'Blackjack: draw a card', async (sock, m, ctx) => module.exports.find((c) => c.name === 'blackjack').run(sock, m, { ...ctx, args: ['hit'] })),
  cmd('stand', 'Blackjack: keep your hand', async (sock, m, ctx) => module.exports.find((c) => c.name === 'blackjack').run(sock, m, { ...ctx, args: ['stand'] })),
  cmd(
    'dicebet',
    'Dice: .dicebet 500 4 (correct = win 5x)',
    async (sock, m, { args }) => {
      const { u } = await acct(m)
      const bet = parseAmt(args[0], Math.min(u.coins, MAX_BET))
      const guess = parseInt(args[1], 10)
      if (!bet || bet < MIN_BET || !(guess >= 1 && guess <= 6)) return m.reply(`Example: .dicebet 500 4 (pick 1-6, min ${MIN_BET}, max ${fmt(MAX_BET)})`)
      if (bet > MAX_BET) return m.reply(`Maximum bet is 💰${fmt(MAX_BET)}.`)
      if (bet > u.coins) return m.reply(`You only have 💰${fmt(u.coins)}.`)
      const roll = rand(1, 6)
      const win = roll === guess
      u.coins += win ? bet * 5 : -bet
      store.save()
      await m.reply(`🎲 The dice rolled *${roll}*\n${win ? `🎉 Correct! You win 💰${fmt(bet * 5)}` : `You guessed ${guess}. You lost 💰${fmt(bet)}`}\nWallet: 💰${fmt(u.coins)}`)
    },
    { aliases: ['dicegame'] }
  ),
  cmd('lottery', 'Buy a lottery ticket (200), draw every hour', async (sock, m, { args }) => {
    if (!m.isGroup) return m.reply('The lottery runs per group. Use it in a group.')
    const { num, u } = await acct(m)
    const db = store.get()
    db.lottery = db.lottery || {}
    // draw late (e.g. after a restart)
    if (db.lottery[m.chat] && db.lottery[m.chat].drawAt <= Date.now()) {
      await drawLottery(sock, m.chat)
    }
    let l = db.lottery[m.chat]
    if ((args[0] || '').toLowerCase() === 'info') {
      if (!l) return m.reply('🎟️ No tickets sold yet. Buy the first one with .lottery')
      return m.reply(`🎟️ *LOTTERY*\nPot: 💰${fmt(l.pot)}\nTickets: ${l.tickets.length}\nYours: ${l.tickets.filter((t) => t === num).length}\nDraw in: ${left(l.drawAt - Date.now())}`)
    }
    const n = Math.min(10, Math.max(1, parseInt(args[0], 10) || 1))
    if (u.coins < 200 * n) return m.reply(`A ticket costs 💰200. You need 💰${fmt(200 * n)}.`)
    u.coins -= 200 * n
    if (!l) l = db.lottery[m.chat] = { pot: 0, tickets: [], drawAt: Date.now() + HOUR }
    for (let i = 0; i < n; i++) l.tickets.push(num)
    l.pot += 200 * n
    store.save()
    armLottery(sock, m.chat)
    await m.reply(`🎟️ Bought ${n} ticket${n > 1 ? 's' : ''}!\nPot: 💰${fmt(l.pot)} • Your tickets: ${l.tickets.filter((t) => t === num).length}\nDraw in ${left(l.drawAt - Date.now())}. Good luck! 🍀`)
  }),
  cmd(
    'coinflipbet',
    'Coin flip bet: .coinflipbet heads 500',
    async (sock, m, { args }) => {
      const { u, e } = await acct(m)
      const side = (args[0] || '').toLowerCase()
      const bet = parseAmt(args[1], Math.min(u.coins, MAX_BET))
      if (!['heads', 'tails'].includes(side) || !bet || bet < MIN_BET) return m.reply(`Example: .coinflipbet heads 500 (min ${MIN_BET}, max ${fmt(MAX_BET)})`)
      if (bet > MAX_BET) return m.reply(`Maximum bet is 💰${fmt(MAX_BET)}.`)
      if (bet > u.coins) return m.reply(`You only have 💰${fmt(u.coins)}.`)
      const win = chance(boostOn(e, 'luckycharm') ? 0.6 : 0.5)
      const landed = win ? side : side === 'heads' ? 'tails' : 'heads'
      u.coins += win ? bet : -bet
      store.save()
      await m.reply(`🪙 It landed on *${landed}*!\n${win ? `You won 💰${fmt(bet)}` : `You lost 💰${fmt(bet)}`}\nWallet: 💰${fmt(u.coins)}`)
    },
    { aliases: ['cfb'] }
  ),

  // ================================================================ BUSINESS
  cmd('business', 'Show your business', async (sock, m) => {
    const { e } = await acct(m)
    if (!e.biz) {
      const list = Object.values(BIZ).map((b) => `• ${b.name} — 💰${fmt(b.price)} (earns 💰${fmt(b.price * 0.1)}/h)`).join('\n')
      return m.reply(`🏢 *BUSINESS*\n\nYou don't own a business yet.\n\n${list}\n\nBuy one: .buy business <type>`)
    }
    const b = e.biz
    const pending = Math.floor(bizHourly(b) * Math.min(24, (Date.now() - b.lastCollect) / HOUR))
    const next = UPG[b.level + 1]
    await m.reply(
      `🏢 *${BIZ[b.type].name.toUpperCase()}*\n\nLevel: ${b.level}/5\nEarnings: 💰${fmt(bizHourly(b))}/hour\nWaiting to collect: 💰${fmt(pending)}\n` +
        (next ? `Next upgrade: 💰${fmt(next)} (.upgrade)` : 'Max level reached! 👑') +
        '\n\nCollect with .collect (profit stops building after 24h)'
    )
  }),
  cmd('collect', 'Collect your business profit', async (sock, m) => {
    const { u, e } = await acct(m)
    if (!e.biz) return m.reply('You have no business. See .business')
    const hours = Math.min(24, (Date.now() - e.biz.lastCollect) / HOUR)
    const profit = Math.floor(bizHourly(e.biz) * hours)
    if (profit < 1) return m.reply('⏳ Nothing to collect yet. Check back in a bit.')
    u.coins += profit
    e.biz.lastCollect = Date.now()
    store.save()
    await m.reply(`🏢 Collected 💰${fmt(profit)} from your ${BIZ[e.biz.type].name}!\nWallet: 💰${fmt(u.coins)}`)
  }),
  cmd('upgrade', 'Upgrade your business (+50% profit per level)', async (sock, m) => {
    const { u, e } = await acct(m)
    if (!e.biz) return m.reply('You have no business. See .business')
    if (e.biz.level >= 5) return m.reply('👑 Your business is already at the max level (5).')
    const cost = UPG[e.biz.level + 1]
    if (u.coins < cost) return m.reply(`Upgrading to level ${e.biz.level + 1} costs 💰${fmt(cost)}. You have 💰${fmt(u.coins)}.`)
    // pay out what was earned at the old rate first
    const pending = Math.floor(bizHourly(e.biz) * Math.min(24, (Date.now() - e.biz.lastCollect) / HOUR))
    u.coins += pending
    e.biz.lastCollect = Date.now()
    u.coins -= cost
    e.biz.level++
    store.save()
    await m.reply(`⬆️ Your ${BIZ[e.biz.type].name} is now level ${e.biz.level}!\nEarns 💰${fmt(bizHourly(e.biz))}/hour${pending ? `\n(Collected 💰${fmt(pending)} pending profit first)` : ''}`)
  }),
  cmd('leaderboard', 'Top 10 richest (wallet + bank + business)', async (sock, m) => {
    const users = store.get().users || {}
    const top = Object.entries(users).map(([id, u]) => ({ id, net: netWorth(u) })).filter((x) => x.net > 0).sort((a, b) => b.net - a.net).slice(0, 10)
    if (!top.length) return m.reply('Nobody has any coins yet. Start with .daily')
    const medals = ['🥇', '🥈', '🥉']
    const lines = top.map((x, i) => `${medals[i] || `${i + 1}.`} @${x.id} — 💰${fmt(x.net)}`)
    await m.reply(`🏆 *RICHEST PLAYERS*\n\n${lines.join('\n')}`, { mentions: top.map((x) => fn.toJid(x.id)) })
  }, { aliases: ['lb', 'toprich'] }),
  cmd('richest', 'Richest person in this group', async (sock, m) => {
    if (!m.isGroup) return m.reply('This command is for groups.')
    const rows = await groupNets(sock, m)
    if (!rows.length) return m.reply('Nobody here has played the economy yet.')
    await m.reply(`👑 *RICHEST IN THE GROUP*\n\n@${rows[0].id} with 💰${fmt(rows[0].net)}`, { mentions: [fn.toJid(rows[0].id)] })
  }),
  cmd('poorest', 'Poorest person in this group', async (sock, m) => {
    if (!m.isGroup) return m.reply('This command is for groups.')
    const rows = await groupNets(sock, m)
    if (!rows.length) return m.reply('Nobody here has played the economy yet.')
    const last = rows[rows.length - 1]
    await m.reply(`🥲 *POOREST IN THE GROUP*\n\n@${last.id} with 💰${fmt(last.net)}\nSomeone send them coins!`, { mentions: [fn.toJid(last.id)] })
  }),
  cmd('donate', 'Donate to the group fund: .donate 500', async (sock, m, { args }) => {
    if (!m.isGroup) return m.reply('The group fund is for groups.')
    const { num, u } = await acct(m)
    const db = store.get()
    db.ecoFund = db.ecoFund || {}
    const amt = parseAmt(args[0], u.coins)
    if (!args[0]) return m.reply(`🏛️ Group fund: 💰${fmt(db.ecoFund[m.chat] || 0)}\nDonate with .donate <amount>`)
    if (!amt || amt < 1) return m.reply('Example: .donate 500')
    if (amt > u.coins) return m.reply(`You only have 💰${fmt(u.coins)}.`)
    u.coins -= amt
    db.ecoFund[m.chat] = (db.ecoFund[m.chat] || 0) + amt
    store.save()
    await m.reply(`🏛️ @${num} donated 💰${fmt(amt)}!\nGroup fund: 💰${fmt(db.ecoFund[m.chat])}`, { mentions: [m.sender] })
  })
]
