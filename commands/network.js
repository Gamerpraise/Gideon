// The shared Gideon Network (server: Global-Gideon-server-main/): a coin world connecting every bot (main + paired) whose owner has
// chosen to join. Off by default. This is a SEPARATE wallet from the local economy
// (commands/economy.js) - the local economy's shop, business and gambling stay per-bot;
// this is just a simple shared balance, .gsend and .grob, arbitrated by network-server/ so
// nobody's downloaded copy of the bot can cheat it. See network-server/README.md to set it up.
const net = require('../network')
const store = require('../store')
const fn = require('../functions')
const config = require('../config')

const CAT = 'global economy'
const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('en-US')
const MIN = 60 * 1000

// Same tables as network-server/economy.js, for display only - the server is the only one that
// actually decides prices/payouts, this is just so .gshop etc. have something to print.
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
const bizHourly = (type, level) => Math.floor(BIZ[type].price * 0.1 * (1 + 0.5 * (level - 1)))

const findKey = (table, q) => {
  q = (q || '').toLowerCase().trim()
  if (!q) return null
  return Object.keys(table).find((k) => k === q || k.startsWith(q) || table[k].name.toLowerCase() === q) || null
}
const parseAmount = (raw, max) => {
  const s = (raw || '').toLowerCase()
  if (s === 'all' || s === 'max') return max
  const n = parseInt(s.replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}
// d / h / m, so a jail sentence of several days reads "5d" instead of "7200m"
const left = (ms) => {
  const mins = Math.ceil(Math.max(0, ms) / MIN)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const mi = mins % 60
  return [d && `${d}d`, h && `${h}h`, (mi || (!d && !h)) && `${mi}m`].filter(Boolean).join(' ')
}

// Same idea as economy.js's own gate: only this bot's owner, and whoever has paired their
// own number, not every random person the bot talks to.
function inNetwork(sock, m) {
  if (m.isOwner) return true
  if (sock.isSub) return false
  const mine = [m.sender, ...(m.senderIds || [])].map(fn.cleanJid)
  return sock.manager.listSubs().some((ctl) => mine.includes(fn.cleanJid(ctl.id)))
}

// .joinnetwork is a decision about THIS specific account (main or one specific paired
// number), so only that account's own owner can make it - a co-owner on the main bot can't,
// same reasoning as .allowdev.
const canToggle = (sock, m) => (sock.isSub ? m.isOwner : m.isMainOwner)

function myNumber(sock) {
  return fn.cleanJid(sock.user?.id || '')
}

function netState(sock) {
  const db = store.get()
  db.network = db.network || {}
  if (!db.network[sock.botId]) db.network[sock.botId] = { joined: false }
  return db.network[sock.botId]
}

async function resolveNumberArg(sock, m, args) {
  const mentioned = m.mentionedJid?.[0]
  if (mentioned) return fn.cleanJid(await fn.resolvePN(sock, mentioned))
  const raw = (args[0] || '').replace(/\D/g, '')
  return raw || null
}

function explainJoin() {
  return (
    `🌍 You're now part of the *Gideon Network*!\n\n` +
    `This connects your bot to a shared coin world with every other Gideon bot whose owner has also joined, ` +
    `no matter who hosts it. Your number and your activity in this network (balance, sends, robs) are visible ` +
    `there to other connected bots, the same way any multiplayer game shows other players.\n\n` +
    `.gbalance - your shared balance\n.gwork - earn coins into your shared balance (30 min cooldown)\n` +
    `.gbank - see your banked coins, safe from .grob\n.gdeposit / .gwithdraw <amount|all> - move coins to/from the bank\n` +
    `.gsend <number> <amount> - send coins to anyone in the network\n` +
    `.grob <number> - try to rob someone in the network\n.grichest / .gpoorest - the shared leaderboard\n\n` +
    `Plus a full economy: .gloan .gshop .gbuy .gsell .guse .ginventory .gjob .gbusiness .gcollect .gupgrade ` +
    `.gcrypto .ginvest .gclaim .gsteal .gscam .gjail .gbail — see ${config.prefix}menu global economy for all of them.\n\n` +
    `This is separate from your local .balance/.shop economy, which stays exactly as it was.\n` +
    `Leave any time with .joinnetwork off, which removes your data from the shared server.`
  )
}


// ---------------------------------------------------------------- net worth
// The server's /richest only ranks by spendable balance, so to rank by what people REALLY own
// we look at each top candidate's full state: wallet + bank + every business (price paid +
// upgrades) + crypto at the market price + an active investment + shop items, minus any loan.
const bizValue = (type, level) => {
  if (!BIZ[type]) return 0
  let v = BIZ[type].price
  for (let l = 2; l <= (level || 1); l++) v += UPG[l] || 0
  return v
}
const numOrObj = (v, key) => (typeof v === 'number' ? v : Number(v?.[key]) || 0)

async function netWorthOf(id, price, fallbackWallet = 0) {
  const [st, bk] = await Promise.all([net.state(id), net.bank(id)])
  const wallet = bk.ok ? Number(bk.balance) || 0 : Number(st.ok ? st.balance : fallbackWallet) || 0
  const banked = bk.ok ? Number(bk.banked) || 0 : 0
  let business = 0
  let items = 0
  let crypto = 0
  let invest = 0
  let loan = 0
  if (st.ok) {
    for (const [type, b] of Object.entries(st.biz || {})) business += bizValue(type, b?.level)
    for (const [k, n] of Object.entries(st.inv || {})) if (ITEMS[k] && n > 0) items += ITEMS[k].price * n
    crypto = Math.floor((Number(st.crypto) || 0) * price)
    invest = numOrObj(st.invest ?? st.investment, 'amount')
    loan = numOrObj(st.loan, 'amount') || numOrObj(st.loan, 'owed')
  }
  const total = Math.max(0, wallet + banked + business + crypto + invest + items - loan)
  return { id, wallet, banked, business, crypto, invest, items, loan, total }
}

function worthLines(w) {
  return [
    `👛 Wallet: 💰${fmt(w.wallet)}`,
    `🏦 Bank: 💰${fmt(w.banked)}`,
    w.business ? `🏢 Businesses: 💰${fmt(w.business)}` : null,
    w.crypto ? `🪙 Crypto: 💰${fmt(w.crypto)}` : null,
    w.invest ? `📊 Invested: 💰${fmt(w.invest)}` : null,
    w.items ? `🎒 Items: 💰${fmt(w.items)}` : null,
    w.loan ? `💸 Loan: -💰${fmt(w.loan)}` : null
  ].filter(Boolean)
}

const worthCache = new Map() // id -> { at, w }
async function cachedWorth(id, price, wallet) {
  const hit = worthCache.get(id)
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.w
  const w = await netWorthOf(id, price, wallet)
  worthCache.set(id, { at: Date.now(), w })
  if (worthCache.size > 500) worthCache.clear()
  return w
}

// shared plumbing for the commands below: gate + joined check + readable errors
const NOT_UPDATED = 'The shared network server has not been updated for this command yet. Ask the developer to update it.'
function gate(sock, m) {
  if (!inNetwork(sock, m)) {
    m.reply("🎮 This is only for Gideon's own people.")
    return false
  }
  if (!netState(sock).joined) {
    m.reply('Join the network first with .joinnetwork on')
    return false
  }
  return true
}
async function failed(m, res, extra = {}) {
  const msg = {
    COOLDOWN: `⏳ That is on cooldown: ${left(res.wait || 0)} left.`,
    JAILED: `🔒 You're in network jail: ${left(res.wait || 0)} left.\nWait it out or ask a friend to .gbail you.`,
    NOT_JOINED: 'You are not on the network.',
    TIMEOUT: 'The network server timed out, try again.',
    NOT_CONFIGURED: 'The network is not set up on this bot.',
    NOT_SUPPORTED: NOT_UPDATED,
    INSUFFICIENT_FUNDS: "You don't have enough coins for that.",
    BAD_BET: 'Bad bet. Min 50, max 5,000.',
    ...extra
  }
  return m.reply(msg[res.error] || `Couldn't do that right now (${res.error}).`)
}

module.exports = [
  {
    name: 'joinnetwork',
    aliases: ['network'],
    desc: 'Join or leave the shared Gideon economy (off by default)',
    category: CAT,
    owner: true,
    // owner: true normally means "main bot only" (handler.js), but this is a decision a paired
    // user makes about their OWN account, same as .allowdev - canToggle() below already checks
    // the right kind of "owner" for whichever account ran it, so it needs to run on subs too.
    subSafe: true,
    async run(sock, m, { args }) {
      if (!canToggle(sock, m)) return m.reply("🔒 Only this bot's own owner can do this.")
      const mode = (args[0] || '').toLowerCase()
      const st = netState(sock)

      if (!mode) {
        return m.reply(
          st.joined
            ? `🌍 This bot is part of the Gideon Network.\nTurn it off any time with .joinnetwork off.`
            : `This bot is not part of the Gideon Network.\nTurn it on with .joinnetwork on to join a shared coin world with every other connected Gideon bot.`
        )
      }
      if (!['on', 'off'].includes(mode)) return m.reply('Example: .joinnetwork on | .joinnetwork off')

      if (mode === 'on') {
        if (st.joined) return m.reply('Already joined. See .joinnetwork for your options.')
        if (!net.configured()) return m.reply("The network server hasn't been set up yet (networkApiUrl/networkKey missing in config). Ask the bot's host to finish that first.")
        const res = await net.join(myNumber(sock))
        if (!res.ok) return m.reply(`Couldn't join the network right now (${res.error}). The shared server may be waking up, try again in a minute.`)
        st.joined = true
        st.joinedAt = Date.now()
        store.save()
        return m.reply(explainJoin() + (res.alreadyJoined ? '' : `\n\nStarting balance: 🌍${fmt(res.balance)}`))
      }

      if (!st.joined) return m.reply('This bot is not part of the network.')
      const res = await net.leave(myNumber(sock))
      st.joined = false
      store.save()
      await m.reply(res.ok ? '👋 Left the Gideon Network. Your shared data has been removed.' : `Left locally, but the server couldn't be reached to remove your data (${res.error}). It will be cleaned up automatically if the bot ever properly logs out.`)
    }
  },
  {
    name: 'gbalance',
    aliases: ['gbal', 'networkbalance'],
    desc: 'Your (or someone else\'s) shared Gideon Network balance with full breakdown',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const st = netState(sock)
      if (!st.joined) return m.reply('This bot has not joined the network yet. Ask the owner to run .joinnetwork on')
      const botNum = myNumber(sock)
      const asked = await resolveNumberArg(sock, m, args)
      let who = asked
      if (!who) {
        // default to the person who typed the command (their own wallet), and only fall back to
        // this bot's own account if that person is not a player on the network
        const sender = fn.cleanJid(await fn.resolvePN(sock, m.sender)).replace(/\D/g, '')
        who = botNum
        if (sender && sender !== botNum) {
          const mine = await net.balance(sender)
          if (mine.ok) who = sender
        }
      }
      const isMe = !asked
      const mention = !isMe ? { mentions: [fn.toJid(who)] } : {}
      const check = await net.balance(who)
      if (!check.ok) return m.reply(check.error === 'not joined' ? `${isMe ? 'You are' : `@${who} is`} not on the network.` : `Couldn't reach the network server (${check.error}).`, mention)
      const market = await net.cryptoMarket()
      const w = await netWorthOf(who, market.ok ? Number(market.price) || 0 : 0, check.balance)
      await m.reply(
        `🌍 *NETWORK BALANCE*${!isMe ? ` @${who}` : ''}\n\n${worthLines(w).join('\n')}\n\n📊 Net worth: 💰${fmt(w.total)}`,
        mention
      )
    }
  },
  {
    name: 'gwork',
    aliases: ['nwork'],
    desc: 'Earn coins into your shared Gideon Network balance (30 min cooldown)',
    category: CAT,
    async run(sock, m) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const st = netState(sock)
      if (!st.joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.work(myNumber(sock))
      if (!res.ok) {
        if (res.error === 'COOLDOWN') return m.reply(`⏳ .gwork is on cooldown: ${Math.ceil(res.wait / 60000)} min left.`)
        const msg = { NOT_JOINED: 'You are not on the network.', TIMEOUT: 'The network server timed out, try again.', NOT_CONFIGURED: 'The network is not set up on this bot.' }
        return m.reply(msg[res.error] || `Couldn't work right now (${res.error}).`)
      }
      await m.reply(`🌍 You worked a shift on the network and earned 💰${fmt(res.earned)}!\nShared balance: 💰${fmt(res.balance)}`)
    }
  },
  {
    name: 'gbank',
    aliases: ['nbank'],
    desc: 'Your banked Gideon Network coins, safe from .grob: .gbank',
    category: CAT,
    async run(sock, m) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const st = netState(sock)
      if (!st.joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.bank(myNumber(sock))
      if (!res.ok) return m.reply(res.error === 'not joined' ? 'You are not on the network.' : `Couldn't reach the network server (${res.error}).`)
      await m.reply(`🏦 *NETWORK BANK*\n\nBalance: 💰${fmt(res.balance)}\nBanked (safe from robbers): 💰${fmt(res.banked)}\n\n.gdeposit <amount|all> • .gwithdraw <amount|all>`)
    }
  },
  {
    name: 'gdeposit',
    aliases: ['ndeposit'],
    desc: 'Move shared balance into your network bank: .gdeposit <amount|all>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const st = netState(sock)
      if (!st.joined) return m.reply('Join the network first with .joinnetwork on')
      const info = await net.bank(myNumber(sock))
      if (!info.ok) return m.reply(`Couldn't reach the network server (${info.error}).`)
      const raw = (args[0] || '').toLowerCase()
      const amount = raw === 'all' || raw === 'max' ? info.balance : parseInt(raw.replace(/,/g, ''), 10)
      if (!amount || amount < 1) return m.reply('Example: .gdeposit 500 or .gdeposit all')
      const res = await net.deposit(myNumber(sock), amount)
      if (!res.ok) return m.reply(res.error === 'INSUFFICIENT_FUNDS' ? "You don't have that much in your shared balance." : `Couldn't deposit (${res.error}).`)
      await m.reply(`🏦 Deposited 💰${fmt(amount)}\nBalance: 💰${fmt(res.balance)} • Banked: 💰${fmt(res.banked)}`)
    }
  },
  {
    name: 'gwithdraw',
    aliases: ['nwithdraw'],
    desc: 'Move coins from your network bank back to balance: .gwithdraw <amount|all>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const st = netState(sock)
      if (!st.joined) return m.reply('Join the network first with .joinnetwork on')
      const info = await net.bank(myNumber(sock))
      if (!info.ok) return m.reply(`Couldn't reach the network server (${info.error}).`)
      const raw = (args[0] || '').toLowerCase()
      const amount = raw === 'all' || raw === 'max' ? info.banked : parseInt(raw.replace(/,/g, ''), 10)
      if (!amount || amount < 1) return m.reply('Example: .gwithdraw 500 or .gwithdraw all')
      const res = await net.withdraw(myNumber(sock), amount)
      if (!res.ok) return m.reply(res.error === 'INSUFFICIENT_FUNDS' ? "You don't have that much banked." : `Couldn't withdraw (${res.error}).`)
      await m.reply(`👛 Withdrew 💰${fmt(amount)}\nBalance: 💰${fmt(res.balance)} • Banked: 💰${fmt(res.banked)}`)
    }
  },
  {
    name: 'gsend',
    aliases: ['gpay', 'nsend'],
    desc: 'Send coins to any number on the Gideon Network: .gsend 2348012345678 100',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const st = netState(sock)
      if (!st.joined) return m.reply('Join the network first with .joinnetwork on')
      const to = (await resolveNumberArg(sock, m, args)) || (args[0] || '').replace(/\D/g, '')
      const amount = parseInt(args.find((a) => /^\d+$/.test(a) && a !== to) || args[1], 10)
      if (!to || !amount || amount < 1) return m.reply('Example: .gsend 2348012345678 100')
      const res = await net.send(myNumber(sock), to, amount)
      if (!res.ok) {
        const msg = { INSUFFICIENT_FUNDS: "You don't have that much.", RECEIVER_NOT_JOINED: "That number hasn't joined the network.", TIMEOUT: 'The network server timed out, try again.', NOT_CONFIGURED: 'The network is not set up on this bot.' }
        return m.reply(msg[res.error] || `Couldn't send (${res.error}).`)
      }
      await m.reply(`🌍 Sent 💰${fmt(amount)} to @${to}\nYour network balance: 💰${fmt(res.fromBalance)}`, { mentions: [fn.toJid(to)] })
    }
  },
  {
    name: 'grob',
    aliases: ['nrob'],
    desc: 'Try to rob someone on the Gideon Network: .grob 2348012345678',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const st = netState(sock)
      if (!st.joined) return m.reply('Join the network first with .joinnetwork on')
      const to = (await resolveNumberArg(sock, m, args)) || (args[0] || '').replace(/\D/g, '')
      if (!to) return m.reply('Example: .grob 2348012345678')
      if (to === myNumber(sock)) return m.reply("You can't rob yourself.")
      const res = await net.rob(myNumber(sock), to)
      if (!res.ok) {
        if (res.error === 'COOLDOWN') return m.reply(`⏳ Rob is on cooldown: ${Math.ceil(res.wait / 60000)} min left.`)
        const msg = { TARGET_NOT_JOINED: "That number hasn't joined the network.", TARGET_TOO_POOR: 'They have barely anything worth taking.', TIMEOUT: 'The network server timed out, try again.', NOT_CONFIGURED: 'The network is not set up on this bot.' }
        return m.reply(msg[res.error] || `Couldn't rob (${res.error}).`)
      }
      if (!res.success) return m.reply(`🚔 You tried to rob @${to} and got nothing. Better luck next time.`, { mentions: [fn.toJid(to)] })
      await m.reply(`🦹 You robbed @${to} on the network and got away with 💰${fmt(res.stolen)}!`, { mentions: [fn.toJid(to)] })
    }
  },
  {
    name: 'grichest',
    aliases: ['networktop', 'nleaderboard'],
    desc: 'Richest players across the whole Gideon Network (full net worth)',
    category: CAT,
    async run(sock, m) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const res = await net.richest(50)
      if (!res.ok) return m.reply(res.error === 'NOT_CONFIGURED' ? 'The network is not set up on this bot.' : `Couldn't reach the network server (${res.error}).`)
      if (!res.players?.length) return m.reply('Nobody has joined the network yet.')
      const rows = []
      if (res.players[0].networth != null) {
        // the server already added up everything each player owns
        for (const p of res.players) rows.push({ id: String(p.id), wallet: 0, banked: 0, business: 0, crypto: 0, invest: 0, items: 0, loan: 0, ...(p.breakdown || {}), total: Number(p.networth) || 0 })
      } else {
        // older server: work it out here from each player's state
        const market = await net.cryptoMarket()
        const price = market.ok ? Number(market.price) || 0 : 0
        for (let i = 0; i < res.players.length; i += 8) {
          const batch = res.players.slice(i, i + 8)
          rows.push(...(await Promise.all(batch.map((p) => cachedWorth(String(p.id), price, p.balance).catch(() => ({ id: String(p.id), wallet: p.balance, banked: 0, business: 0, crypto: 0, invest: 0, items: 0, loan: 0, total: Number(p.balance) || 0 }))))))
        }
      }
      rows.sort((a, b) => b.total - a.total)
      const top = rows.slice(0, 10)
      const medals = ['🥇', '🥈', '🥉']
      const lines = top.map((p, i) => `${medals[i] || `${i + 1}.`} @${p.id} — 💰${fmt(p.total)}`)
      await m.reply(
        `🌍 *NETWORK RICHEST*\n_(ranked by total net worth)_\n\n${lines.join('\n')}\n\n_Use .gbalance to see your own breakdown._`,
        { mentions: top.map((p) => fn.toJid(p.id)) }
      )
    }
  },
  {
    name: 'gnetworth',
    aliases: ['gnw', 'nnetworth'],
    desc: 'Full net worth breakdown on the network: .gnetworth [@user|number]',
    category: CAT,
    async run(sock, m, { args }) {
      if (!gate(sock, m)) return
      const who = (await resolveNumberArg(sock, m, args)) || myNumber(sock)
      const market = await net.cryptoMarket()
      const w = await netWorthOf(who, market.ok ? Number(market.price) || 0 : 0)
      await m.reply(`💎 *NET WORTH* @${who}\n\n${worthLines(w).join('\n')}\n\n📊 Total: 💰${fmt(w.total)}`, { mentions: [fn.toJid(who)] })
    }
  },
  {
    name: 'gpoorest',
    aliases: ['nworst'],
    desc: 'Poorest player across the whole Gideon Network',
    category: CAT,
    async run(sock, m) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const res = await net.poorest()
      if (!res.ok) return m.reply(res.error === 'NOT_CONFIGURED' ? 'The network is not set up on this bot.' : `Couldn't reach the network server (${res.error}).`)
      if (!res.player) return m.reply('Nobody has joined the network yet.')
      await m.reply(`🌍 *NETWORK POOREST*\n\n@${res.player.id} with 💰${fmt(res.player.networth ?? res.player.balance)}`, { mentions: [fn.toJid(res.player.id)] })
    }
  },
  {
    name: 'gloan',
    aliases: ['nloan'],
    desc: 'Borrow up to 2000 on the network (10% interest): .gloan <amount>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.loan(myNumber(sock), parseInt((args[0] || '').replace(/,/g, ''), 10) || 2000)
      if (!res.ok) {
        if (res.error === 'LOAN_EXISTS') return m.reply('💸 You already have an outstanding network loan. Pay it with .gpayloan.')
        return m.reply(`Couldn't get a loan (${res.error}).`)
      }
      await m.reply(`🏦 Network loan approved: +💰${fmt(res.amount)}.\nYou owe 💰${fmt(res.loan)} (10% interest). Pay within 24h with .gpayloan or you'll be jailed.`)
    }
  },
  {
    name: 'gpayloan',
    aliases: ['npayloan'],
    desc: 'Pay back your network loan: .gpayloan <amount|all>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.payloan(myNumber(sock), parseAmount(args[0], 999999999))
      if (!res.ok) return m.reply(res.error === 'NO_LOAN' ? 'You have no network loan.' : res.error === 'INSUFFICIENT_FUNDS' ? "You don't have that much in your shared balance." : `Couldn't pay (${res.error}).`)
      await m.reply(res.loan ? `✅ Paid 💰${fmt(res.paid)}. Still owing 💰${fmt(res.loan)}.` : '✅ Network loan fully paid. Debt free! 🎉')
    }
  },
  {
    name: 'gshop',
    aliases: ['nshop'],
    desc: 'The network item shop: .gbuy / .gsell / .guse / .ginventory',
    category: CAT,
    async run(sock, m) {
      const lines = Object.values(ITEMS).map((i) => `${i.emoji} ${i.name} — 💰${fmt(i.price)}`)
      await m.reply(`🛒 *NETWORK SHOP*\n\n${lines.join('\n')}\n\n.gbuy <item> • .gsell <item> (50% back) • .guse <item> • .ginventory`)
    }
  },
  {
    name: 'gbuy',
    aliases: ['nbuy'],
    desc: 'Buy a network item: .gbuy shield',
    category: CAT,
    async run(sock, m, { args, text }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const key = findKey(ITEMS, text)
      if (!key) return m.reply('Unknown item. Use .gshop to see what is for sale.')
      const res = await net.itemBuy(myNumber(sock), key)
      if (!res.ok) return m.reply(res.error === 'INSUFFICIENT_FUNDS' ? `You need 💰${fmt(ITEMS[key].price)} for a ${ITEMS[key].name}.` : `Couldn't buy (${res.error}).`)
      await m.reply(`${ITEMS[key].emoji} Bought 1 ${ITEMS[key].name} for 💰${fmt(res.price)}\nBalance: 💰${fmt(res.balance)}`)
    }
  },
  {
    name: 'gsell',
    aliases: ['nsell'],
    desc: 'Sell a network item for 50% back: .gsell shield',
    category: CAT,
    async run(sock, m, { text }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const key = findKey(ITEMS, text)
      if (!key) return m.reply('Example: .gsell shield')
      const res = await net.itemSell(myNumber(sock), key)
      if (!res.ok) return m.reply(res.error === 'NOT_OWNED' ? `You don't own a ${ITEMS[key].name}.` : `Couldn't sell (${res.error}).`)
      await m.reply(`💰 Sold ${ITEMS[key].name} for 💰${fmt(res.gain)}\nBalance: 💰${fmt(res.balance)}`)
    }
  },
  {
    name: 'guse',
    aliases: ['nuse'],
    desc: 'Use a network item: .guse shield (gold watch and diamond ring are collectibles)',
    category: CAT,
    async run(sock, m, { text }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const key = findKey(ITEMS, text)
      if (!key) return m.reply('Example: .guse shield')
      const res = await net.itemUse(myNumber(sock), key)
      if (!res.ok) {
        if (res.error === 'NOT_OWNED') return m.reply(`You don't own a ${ITEMS[key].name}.`)
        if (res.error === 'ALREADY_ARMED') return m.reply('That is already armed.')
        if (res.error === 'NOT_USABLE') return m.reply(`${ITEMS[key].emoji} ${ITEMS[key].name} is a collectible. Keep it as a flex or .gsell it for 50%.`)
        return m.reply(`Couldn't use that (${res.error}).`)
      }
      const msg = { armed: `${ITEMS[key].emoji} ${ITEMS[key].name} armed.`, work_cooldown_cleared: '⚡ Your .gwork cooldown is cleared. Use it now!', lucky: '🍀 Lucky Charm active for 1 hour: +10% win chance on .ggamble, .groulette and .gcoinflip.', pickaxe: '⛏️ Pickaxe active for 1 hour: .gmine pays double.', fishingrod: '🎣 Fishing Rod active for 1 hour: .gfish pays double.' }
      await m.reply(msg[res.effect] || 'Done.')
    }
  },
  {
    name: 'ginventory',
    aliases: ['ninventory', 'ginv', 'nbag'],
    desc: 'Your network items',
    category: CAT,
    async run(sock, m) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.state(myNumber(sock))
      if (!res.ok) return m.reply(`Couldn't reach the network server (${res.error}).`)
      const entries = Object.entries(res.inv || {}).filter(([k, n]) => ITEMS[k] && n > 0)
      const list = entries.length ? entries.map(([k, n]) => `${ITEMS[k].emoji} ${ITEMS[k].name} x${n}`).join('\n') : 'Empty. Visit .gshop'
      const active = []
      if (res.inv?.shieldArmed) active.push('🛡️ Shield armed')
      if (res.inv?.fakeidArmed) active.push('🪪 Fake ID armed')
      await m.reply(`🎒 *NETWORK INVENTORY*\n\n${list}${active.length ? `\n\n*Active*\n${active.join('\n')}` : ''}`)
    }
  },
  {
    name: 'gjob',
    aliases: ['njob'],
    desc: 'List/pick a network job, boosts .gwork payout: .gjob driver',
    category: CAT,
    async run(sock, m, { args, text }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      if (!text) {
        const list = Object.values(JOBS).map((j) => `• ${j.name}: 💰${j.min}-${j.max} per .gwork`).join('\n')
        const res = await net.state(myNumber(sock))
        return m.reply(`💼 *NETWORK JOBS*\n\n${list}\n\nYour job: ${res.ok ? JOBS[res.job]?.name || 'none (default pay)' : 'unknown'}\nPick one: .gjob <name>`)
      }
      const key = findKey(JOBS, text)
      if (!key) return m.reply('Unknown job. Use .gjob to see the list.')
      const res = await net.setJob(myNumber(sock), key)
      if (!res.ok) return m.reply(`Couldn't set that job (${res.error}).`)
      await m.reply(`✅ You are now a ${JOBS[key].name} on the network. Use .gwork to earn 💰${JOBS[key].min}-${JOBS[key].max}.`)
    }
  },
  {
    name: 'gbusiness',
    aliases: ['nbusiness', 'gbiz'],
    desc: 'Your network businesses (you can own several), or buy one: .gbusiness / .gbusiness buy <type>',
    category: CAT,
    async run(sock, m, { args, text }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const q = (args[0] || '').toLowerCase()
      if (q === 'buy') {
        const key = findKey(BIZ, text.replace(/^buy\s*/i, ''))
        if (!key) {
          const list = Object.values(BIZ).map((b) => `• ${b.name} — 💰${fmt(b.price)}`).join('\n')
          return m.reply(`🏢 *NETWORK BUSINESSES*\n\n${list}\n\nExample: .gbusiness buy mama put (you can own more than one, different types)`)
        }
        const res = await net.bizBuy(myNumber(sock), key)
        if (!res.ok) return m.reply(res.error === 'ALREADY_OWNS' ? `You already own a ${BIZ[key].name}. Buy a different type, or .gupgrade this one.` : res.error === 'INSUFFICIENT_FUNDS' ? `You need 💰${fmt(BIZ[key].price)} for a ${BIZ[key].name}.` : `Couldn't buy (${res.error}).`)
        return m.reply(`🏢 You bought a *${BIZ[key].name}* on the network!\nEarns 💰${fmt(res.hourly)}/hour. Use .gcollect, .gupgrade ${BIZ[key].name.toLowerCase()}, or .gsellbiz ${BIZ[key].name.toLowerCase()}`)
      }
      const res = await net.state(myNumber(sock))
      if (!res.ok) return m.reply(`Couldn't reach the network server (${res.error}).`)
      const owned = Object.entries(res.biz || {})
      if (!owned.length) {
        const list = Object.values(BIZ).map((b) => `• ${b.name} — 💰${fmt(b.price)} (earns 💰${fmt(b.price * 0.1)}/h)`).join('\n')
        return m.reply(`🏢 *NETWORK BUSINESS*\n\nYou don't own any yet.\n\n${list}\n\nBuy one: .gbusiness buy <type>`)
      }
      const blocks = owned.map(([type, b]) => {
        const pending = Math.floor(bizHourly(type, b.level) * Math.min(24, (Date.now() - b.lastCollect) / (60 * MIN)))
        const next = UPG[b.level + 1]
        return `*${BIZ[type].name.toUpperCase()}* — Level ${b.level}/5\nEarnings: 💰${fmt(bizHourly(type, b.level))}/hour\nWaiting: 💰${fmt(pending)}\n${next ? `Next upgrade: 💰${fmt(next)}` : 'Max level! 👑'}`
      })
      await m.reply(`🏢 *NETWORK BUSINESSES*\n\n${blocks.join('\n\n')}\n\n.gcollect (all at once) • .gupgrade <name> • .gsellbiz <name>`)
    }
  },
  {
    name: 'gcollect',
    aliases: ['ncollect'],
    desc: 'Collect network business profit - all of them, or name one: .gcollect [business]',
    category: CAT,
    async run(sock, m, { text }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const key = text ? findKey(BIZ, text) : null
      if (text && !key) return m.reply('Unknown business. .gbusiness to see what you own.')
      const res = await net.bizCollect(myNumber(sock), key || undefined)
      if (!res.ok) return m.reply(res.error === 'NO_BUSINESS' ? 'You have no network business like that. See .gbusiness' : res.error === 'NOTHING_YET' ? '⏳ Nothing to collect yet.' : `Couldn't collect (${res.error}).`)
      const breakdown = Object.entries(res.breakdown || {})
      const extra = breakdown.length > 1 ? `\n${breakdown.map(([t, amt]) => `• ${BIZ[t].name}: 💰${fmt(amt)}`).join('\n')}` : ''
      await m.reply(`🏢 Collected 💰${fmt(res.profit)} from your network business${breakdown.length > 1 ? 'es' : ''}!${extra}`)
    }
  },
  {
    name: 'gupgrade',
    aliases: ['nupgrade'],
    desc: 'Upgrade a network business (+50% profit per level): .gupgrade <business name>',
    category: CAT,
    async run(sock, m, { text }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const key = text ? findKey(BIZ, text) : null
      if (text && !key) return m.reply('Unknown business. .gbusiness to see what you own.')
      const res = await net.bizUpgrade(myNumber(sock), key || undefined)
      if (!res.ok) {
        const msg = {
          SPECIFY_TYPE: 'You own more than one business - say which: .gupgrade mama put',
          NO_BUSINESS: 'You have no network business like that. See .gbusiness',
          MAX_LEVEL: '👑 Already at the max level (5).',
          INSUFFICIENT_FUNDS: "You don't have enough for this upgrade yet."
        }
        return m.reply(msg[res.error] || `Couldn't upgrade (${res.error}).`)
      }
      await m.reply(`⬆️ Your ${BIZ[res.type].name} is now level ${res.level}!\nEarns 💰${fmt(res.hourly)}/hour${res.pending ? `\n(Collected 💰${fmt(res.pending)} pending profit first)` : ''}`)
    }
  },
  {
    // Separate from .gsell (which sells an item) - .gsell is already taken above.
    name: 'gsellbiz',
    aliases: ['gbizsell', 'nsellbiz'],
    desc: 'Sell a network business for 50% of what you put into it: .gsellbiz <business name>',
    category: CAT,
    async run(sock, m, { text }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const key = text ? findKey(BIZ, text) : null
      if (text && !key) return m.reply('Unknown business. .gbusiness to see what you own.')
      const res = await net.bizSell(myNumber(sock), key || undefined)
      if (!res.ok) {
        const msg = { SPECIFY_TYPE: 'You own more than one business - say which: .gsellbiz mama put', NO_BUSINESS: 'You have no network business like that. See .gbusiness' }
        return m.reply(msg[res.error] || `Couldn't sell (${res.error}).`)
      }
      await m.reply(`💰 Sold your ${BIZ[res.type].name} for 💰${fmt(res.gain)}${res.pending ? ` (plus 💰${fmt(res.pending)} pending profit collected first)` : ''}.`)
    }
  },
  {
    name: 'gcrypto',
    aliases: ['ncrypto'],
    desc: 'The network\'s shared coin market: .gcrypto buy/sell <amount>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const sub = (args[0] || '').toLowerCase()
      if (sub === 'buy' || sub === 'sell') {
        const units = parseInt((args[1] || '').replace(/,/g, ''), 10)
        if (!units || units < 1) return m.reply(`Example: .gcrypto ${sub} 5`)
        const res = await net.cryptoTrade(myNumber(sock), sub, units)
        if (!res.ok) return m.reply(res.error === 'INSUFFICIENT_FUNDS' ? 'You cannot afford that many units.' : res.error === 'NOTHING_TO_SELL' ? "You don't hold that many units." : `Couldn't trade (${res.error}).`)
        return m.reply(
          sub === 'buy'
            ? `📈 Bought ${fmt(res.units)} GDN for 💰${fmt(res.cost)} (price ${res.price.toFixed(2)})`
            : `📉 Sold ${fmt(res.units)} GDN for 💰${fmt(res.gain)} (price ${res.price.toFixed(2)})`
        )
      }
      const [market, state] = await Promise.all([net.cryptoMarket(), net.state(myNumber(sock))])
      if (!market.ok) return m.reply(`Couldn't reach the network server (${market.error}).`)
      const arrow = market.change > 0 ? '📈' : market.change < 0 ? '📉' : '➖'
      const holdings = state.ok ? state.crypto : 0
      await m.reply(
        `🪙 *GIDEON COIN (GDN)* — network-wide\n\nPrice: 💰${market.price.toFixed(2)} ${arrow} ${market.change >= 0 ? '+' : ''}${market.change.toFixed(1)}%\nYour holdings: ${fmt(holdings)} GDN (💰${fmt(market.price * holdings)})\n\n.gcrypto buy <amount> • .gcrypto sell <amount>`
      )
    }
  },
  {
    name: 'ginvest',
    aliases: ['ninvest'],
    desc: 'Invest network coins (min 100), claim after 1h with .gclaim',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const amount = parseInt((args[0] || '').replace(/,/g, ''), 10)
      if (!amount || amount < 100) return m.reply('Example: .ginvest 500 (minimum 100)')
      const res = await net.invest(myNumber(sock), amount)
      if (!res.ok) return m.reply(res.error === 'ALREADY_INVESTING' ? 'You already have a network investment running. Use .gclaim once it matures.' : res.error === 'BAD_AMOUNT' ? "You don't have that much in your shared balance." : `Couldn't invest (${res.error}).`)
      await m.reply(`📊 Invested 💰${fmt(res.amount)} on the network. Come back in 1 hour and use .gclaim.`)
    }
  },
  {
    name: 'gclaim',
    aliases: ['nclaim'],
    desc: 'Claim your finished network investment',
    category: CAT,
    async run(sock, m) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.investClaim(myNumber(sock))
      if (!res.ok) {
        if (res.error === 'NO_INVESTMENT') return m.reply('You have no active network investment. Use .ginvest <amount>')
        if (res.error === 'COOLDOWN') return m.reply(`⏳ Not ready yet. ${left(res.wait)} left.`)
        return m.reply(`Couldn't claim (${res.error}).`)
      }
      await m.reply(`${res.pct >= 0 ? '📈' : '📉'} Investment result: ${res.pct >= 0 ? '+' : ''}${(res.pct * 100).toFixed(1)}%\n💰${fmt(res.base)} → 💰${fmt(res.payout)}`)
    }
  },
  {
    name: 'gsteal',
    aliases: ['nsteal'],
    desc: 'Steal a random network item from someone: .gsteal <number>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const to = (await resolveNumberArg(sock, m, args)) || (args[0] || '').replace(/\D/g, '')
      if (!to) return m.reply('Example: .gsteal 2348012345678')
      if (to === myNumber(sock)) return m.reply("You can't steal from yourself.")
      const res = await net.steal(myNumber(sock), to)
      if (!res.ok) {
        if (res.error === 'JAILED') return m.reply(`🔒 You're in network jail: ${left(res.wait)} left.`)
        if (res.error === 'COOLDOWN') return m.reply(`⏳ .gsteal is on cooldown: ${left(res.wait)} left.`)
        return m.reply(res.error === 'TARGET_NOT_JOINED' ? "That number hasn't joined the network." : `Couldn't steal (${res.error}).`)
      }
      if (res.reason === 'NOTHING_TO_STEAL') return m.reply(`@${to} has no network items worth stealing.`, { mentions: [fn.toJid(to)] })
      if (res.reason === 'CAUGHT') return m.reply(`🚔 You got caught stealing! Jailed for ${left(res.jailMs)}.`)
      await m.reply(`🥷 You stole a ${ITEMS[res.item].emoji} ${ITEMS[res.item].name} from @${to} on the network!`, { mentions: [fn.toJid(to)] })
    }
  },
  {
    name: 'gscam',
    aliases: ['nscam'],
    desc: 'Scam someone on the network: .gscam <number>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const to = (await resolveNumberArg(sock, m, args)) || (args[0] || '').replace(/\D/g, '')
      if (!to) return m.reply('Example: .gscam 2348012345678')
      if (to === myNumber(sock)) return m.reply("You can't scam yourself.")
      const res = await net.scam(myNumber(sock), to)
      if (!res.ok) {
        if (res.error === 'JAILED') return m.reply(`🔒 You're in network jail: ${left(res.wait)} left.`)
        if (res.error === 'COOLDOWN') return m.reply(`⏳ .gscam is on cooldown: ${left(res.wait)} left.`)
        return m.reply(res.error === 'TARGET_NOT_JOINED' ? "That number hasn't joined the network." : `Couldn't scam (${res.error}).`)
      }
      if (res.reason === 'TARGET_EMPTY') return m.reply(`@${to} has nothing to scam.`, { mentions: [fn.toJid(to)] })
      if (res.reason === 'BACKFIRED') return m.reply(`🚔 The scam backfired! You lost 💰${fmt(res.lost)} and got ${left(res.jailMs)} in network jail.`)
      await m.reply(`🎭 Scam successful! @${to} sent you 💰${fmt(res.amount)} on the network.`, { mentions: [fn.toJid(to)] })
    }
  },
  {
    name: 'gjail',
    aliases: ['njail'],
    desc: 'See who is in network jail',
    category: CAT,
    async run(sock, m) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      const res = await net.jailList(25)
      if (!res.ok) return m.reply(`Couldn't reach the network server (${res.error}).`)
      if (!res.players?.length) return m.reply('🔓 Nobody is in network jail right now.')
      const lines = res.players.map((p) => `🔒 @${p.id} — ${left(p.jailUntil - Date.now())}`)
      await m.reply(`⛓️ *NETWORK JAIL*\n\n${lines.join('\n')}\n\nFree someone with .gbail <number> (💰500)`, { mentions: res.players.map((p) => fn.toJid(p.id)) })
    }
  },
  {
    name: 'gbail',
    aliases: ['nbail'],
    desc: 'Pay 500 to free someone from network jail: .gbail <number>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const to = (await resolveNumberArg(sock, m, args)) || (args[0] || '').replace(/\D/g, '')
      if (!to) return m.reply('Example: .gbail 2348012345678')
      if (to === myNumber(sock)) return m.reply('You cannot bail yourself out, you need a friend.')
      const res = await net.bail(myNumber(sock), to)
      if (!res.ok) return m.reply(res.error === 'NOT_JAILED' ? `@${to} is not in network jail.` : res.error === 'INSUFFICIENT_FUNDS' ? 'Bail costs 💰500 and you don\'t have that.' : `Couldn't bail (${res.error}).`, { mentions: [fn.toJid(to)] })
      await m.reply(`🔓 You paid 💰500 and freed @${to} from network jail!`, { mentions: [fn.toJid(to)] })
    }
  },
  {
    name: 'ggift',
    aliases: ['ngift'],
    desc: 'Send network coins and announce it to the chat: .ggift <number> <amount>',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const to = (await resolveNumberArg(sock, m, args)) || (args[0] || '').replace(/\D/g, '')
      const amount = parseInt(args.find((a) => /^\d+$/.test(a) && a !== to) || args[1], 10)
      if (!to || !amount || amount < 1) return m.reply('Example: .ggift 2348012345678 100')
      if (to === myNumber(sock)) return m.reply("You can't gift yourself.")
      const res = await net.send(myNumber(sock), to, amount)
      if (!res.ok) {
        const msg = { INSUFFICIENT_FUNDS: "You don't have that much.", RECEIVER_NOT_JOINED: "That number hasn't joined the network." }
        return m.reply(msg[res.error] || `Couldn't gift (${res.error}).`)
      }
      await sock.sendMessage(m.chat, { text: `🎁 *NETWORK GIFT* 🎁\n\n@${myNumber(sock)} just gifted 💰${fmt(amount)} to @${to}!\nWhat a legend 👏`, mentions: [m.sender, fn.toJid(to)] }, { quoted: m._msg })
    }
  },
  {
    name: 'ggamble',
    aliases: ['ngamble', 'gbet'],
    desc: `Gamble network coins, 50% to double: .ggamble <amount> (min ${50}, max ${5000})`,
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.gamble(myNumber(sock), args[0])
      if (!res.ok) return m.reply(res.error === 'BAD_BET' ? 'Example: .ggamble 500 (min 50, max 5,000)' : res.error === 'INSUFFICIENT_FUNDS' ? `You only have that much in your shared balance.` : `Couldn't gamble (${res.error}).`)
      await m.reply(res.win ? `🎲 You won 💰${fmt(res.bet)}!${res.lucky ? ' 🍀' : ''}\nBalance: 💰${fmt(res.balance)}` : `🎲 You lost 💰${fmt(res.bet)}.\nBalance: 💰${fmt(res.balance)}`)
    }
  },
  {
    name: 'gslots',
    aliases: ['nslots'],
    desc: 'Network slot machine (100 per spin)',
    category: CAT,
    async run(sock, m) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.slots(myNumber(sock))
      if (!res.ok) return m.reply(res.error === 'INSUFFICIENT_FUNDS' ? 'A spin costs 💰100.' : `Couldn't spin (${res.error}).`)
      const msg = res.prize === 1000 ? '🎉 JACKPOT! 3 of a kind!' : res.prize === 200 ? '✨ 2 of a kind!' : '😔 No match. You lose 💰100.'
      await m.reply(`🎰 [ ${res.reel.join(' | ')} ]\n\n${msg}${res.prize ? ` You win 💰${fmt(res.prize)}` : ''}\nBalance: 💰${fmt(res.balance)}`)
    }
  },
  {
    name: 'groulette',
    aliases: ['nroulette'],
    desc: 'Network roulette: .groulette red 500 (48% to double)',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.roulette(myNumber(sock), args[0], args[1])
      if (!res.ok) return m.reply(res.error === 'BAD_BET' ? 'Example: .groulette red 500 (min 50, max 5,000)' : res.error === 'INSUFFICIENT_FUNDS' ? 'You only have that much in your shared balance.' : `Couldn't play (${res.error}).`)
      await m.reply(`🎡 The ball landed on ${res.landed === 'red' ? '🔴 red' : '⚫ black'}!\n${res.win ? `You won 💰${fmt(res.bet)}` : `You lost 💰${fmt(res.bet)}`}\nBalance: 💰${fmt(res.balance)}`)
    }
  },
  {
    name: 'gdicebet',
    aliases: ['ndicebet', 'gdicegame'],
    desc: 'Network dice: .gdicebet 500 4 (correct = win 5x)',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.dicebet(myNumber(sock), args[0], args[1])
      if (!res.ok) return m.reply(res.error === 'BAD_BET' ? 'Example: .gdicebet 500 4 (pick 1-6, min 50, max 5,000)' : res.error === 'INSUFFICIENT_FUNDS' ? 'You only have that much in your shared balance.' : `Couldn't play (${res.error}).`)
      await m.reply(`🎲 The dice rolled *${res.roll}*\n${res.win ? `🎉 Correct! You win 💰${fmt(res.bet * 5)}` : `You lost 💰${fmt(res.bet)}`}\nBalance: 💰${fmt(res.balance)}`)
    }
  },
  {
    name: 'gcoinflip',
    aliases: ['ncoinflip', 'gcfb'],
    desc: 'Network coin flip bet: .gcoinflip heads 500',
    category: CAT,
    async run(sock, m, { args }) {
      if (!inNetwork(sock, m)) return m.reply('🎮 This is only for Gideon\'s own people.')
      if (!netState(sock).joined) return m.reply('Join the network first with .joinnetwork on')
      const res = await net.coinflip(myNumber(sock), args[0], args[1])
      if (!res.ok) return m.reply(res.error === 'BAD_BET' ? 'Example: .gcoinflip heads 500 (min 50, max 5,000)' : res.error === 'INSUFFICIENT_FUNDS' ? 'You only have that much in your shared balance.' : `Couldn't play (${res.error}).`)
      await m.reply(`🪙 It landed on *${res.landed}*!\n${res.win ? `You won 💰${fmt(res.bet)}` : `You lost 💰${fmt(res.bet)}`}\nBalance: 💰${fmt(res.balance)}`)
    }
  }
]

// ======================================================================== ported from the local economy
// Everything below mirrors a local-economy command. The shared server owns the cooldowns, payouts,
// jail checks and dice, so these only ask it to do the thing and show the result.

const EARN = {
  daily: { desc: 'Claim your daily network coins (every 24h)', icon: '🎁', label: 'Daily claimed' },
  weekly: { desc: 'Claim your weekly network coins (every 7 days)', icon: '🎉', label: 'Weekly claimed' },
  overtime: { desc: 'Network overtime pay (risk of falling sick)', icon: '🌙', label: 'Overtime' },
  beg: { desc: 'Beg for network coins (50% chance)', icon: '🙏', label: 'A stranger gave you' },
  hustle: { desc: 'Random network hustle', icon: '🏃', label: 'Hustle paid' },
  mine: { desc: 'Mine for network coins (cave-in risk)', icon: '⛏️', label: 'You mined' },
  fish: { desc: 'Go fishing for network coins', icon: '🎣', label: 'You caught fish worth' },
  farm: { desc: 'Farm for network coins (bad harvest risk)', icon: '🌽', label: 'You sold your harvest for' },
  hunt: { desc: 'Hunt for network coins (you can lose)', icon: '🏹', label: 'Great hunt!' }
}

const earnCommands = Object.entries(EARN).map(([action, info]) => ({
  name: `g${action}`,
  aliases: [`n${action}`],
  desc: info.desc,
  category: CAT,
  async run(sock, m) {
    if (!gate(sock, m)) return
    const res = await net.earn(myNumber(sock), action)
    if (!res.ok) return failed(m, res, { COOLDOWN: `⏳ .g${action} is on cooldown: ${left(res.wait || 0)} left.` })
    const earned = Number(res.earned) || 0
    let line
    if (res.note) line = `${info.icon} ${res.note}`
    else if (earned > 0) line = `${info.icon} ${info.label}: +💰${fmt(earned)}`
    else if (earned < 0) line = `😔 It went wrong and you lost 💰${fmt(-earned)}.`
    else line = `${info.icon} Nothing this time. Try again later.`
    await m.reply(`${line}\nBalance: 💰${fmt(res.balance)}`)
  }
}))

const heists = new Map() // chat -> { members: Map(number -> jid), timer }
const jailDays = (ms) => left(ms)

const extraCommands = [
  ...earnCommands,
  {
    name: 'gtrade',
    aliases: ['ntrade'],
    desc: 'Trade a network item: .gtrade <number> <item> [price] | .gtrade accept | .gtrade decline',
    category: CAT,
    async run(sock, m, { args }) {
      if (!gate(sock, m)) return
      const sub = (args[0] || '').toLowerCase()
      if (sub === 'accept' || sub === 'decline') {
        const res = await net.tradeRespond(myNumber(sock), sub === 'accept')
        if (!res.ok) return failed(m, res, { NO_OFFER: 'You have no pending trade offer.', NOT_OWNED: 'The other person no longer has that item.' })
        return m.reply(sub === 'accept' ? `🤝 Trade done! You received ${ITEMS[res.item]?.name || res.item}${res.price ? ` for 💰${fmt(res.price)}` : ''}.` : '❌ Trade declined.')
      }
      const to = (await resolveNumberArg(sock, m, args)) || (args[0] || '').replace(/\D/g, '')
      const rest = args.filter((a) => !a.startsWith('@') && a.replace(/\D/g, '') !== to)
      const key = findKey(ITEMS, rest.filter((a) => !/^\d+$/.test(a)).join(' '))
      const price = parseInt(rest.find((a) => /^\d+$/.test(a)) || '0', 10)
      if (!to || !key) return m.reply('Example: .gtrade 2348012345678 shield (free) or .gtrade 2348012345678 shield 500 (they pay 500)')
      if (to === myNumber(sock)) return m.reply("You can't trade with yourself.")
      const res = await net.tradeOffer(myNumber(sock), to, key, price)
      if (!res.ok) return failed(m, res, { NOT_OWNED: `You don't own a ${ITEMS[key].name}.`, TARGET_NOT_JOINED: "That number hasn't joined the network." })
      await m.reply(`🤝 @${to}, @${myNumber(sock)} offers you ${ITEMS[key].emoji} ${ITEMS[key].name}${price ? ` for 💰${fmt(price)}` : ' for free'}.\nReply with .gtrade accept or .gtrade decline (2 min).`, { mentions: [fn.toJid(to), m.sender] })
    }
  },
  {
    name: 'gpolice',
    aliases: ['npolice'],
    desc: 'Call the police on the last network robber (10 min window)',
    category: CAT,
    async run(sock, m) {
      if (!gate(sock, m)) return
      const res = await net.police(myNumber(sock), m.chat)
      if (!res.ok) return failed(m, res, { NO_ROBBERY: '🚓 No network robbery was reported in the last 10 minutes.', SELF: '🚓 Calling the police on yourself? Nice try.', ALREADY_CHECKED: '🚓 The police already investigated that case.' })
      if (!res.caught) return m.reply('🚓 The police searched but found no evidence. The robber got away!')
      await sock.sendMessage(m.chat, { text: `🚓 *ROBBER CAUGHT!*\n@${res.robber} lost 💰${fmt(res.amount)} (returned to @${res.victim}) and is jailed for ${jailDays(res.jailMs)}.`, mentions: [fn.toJid(res.robber), fn.toJid(res.victim)] }, { quoted: m._msg })
    }
  },
  {
    name: 'gheist',
    aliases: ['nheist'],
    desc: 'Network heist (3+ people): .gheist then .gheist join',
    category: CAT,
    async run(sock, m, { args }) {
      if (!m.isGroup) return m.reply('Heists are for groups.')
      if (!gate(sock, m)) return
      const num = myNumber(sock)
      const me = fn.cleanJid(m.sender)
      const sub = (args[0] || '').toLowerCase()
      const h = heists.get(m.chat)
      if (sub === 'join') {
        if (!h) return m.reply('No heist is being planned. Start one with .gheist')
        if (h.members.has(me)) return m.reply('You already joined this heist.')
        h.members.set(me, m.sender)
        return m.reply(`🕶️ @${me} joined the heist! (${h.members.size}/3 needed)`, { mentions: [m.sender] })
      }
      if (h) return m.reply(`A heist is already planned. ${h.members.size}/3 joined. Use .gheist join`)
      const state = { members: new Map([[me, m.sender]]) }
      heists.set(m.chat, state)
      state.timer = setTimeout(async () => {
        heists.delete(m.chat)
        try {
          const ids = [...state.members.keys()]
          const jids = [...state.members.values()]
          if (ids.length < 3) return sock.sendMessage(m.chat, { text: `🚫 Heist cancelled. Only ${ids.length}/3 people joined.` })
          const res = await net.heist(ids)
          const tag = ids.map((i) => `@${i}`).join(' ')
          if (!res.ok) return sock.sendMessage(m.chat, { text: res.error === 'NOT_SUPPORTED' ? NOT_UPDATED : `Heist could not run (${res.error}).` })
          if (res.success) await sock.sendMessage(m.chat, { text: `💎 *HEIST SUCCESS!*\n${tag}\n\nThe crew stole 💰${fmt(res.total)}. Each member gets 💰${fmt(res.share)}!`, mentions: jids })
          else await sock.sendMessage(m.chat, { text: `🚔 *HEIST FAILED!*\n${tag}\n\nThe police caught everyone. All jailed for ${jailDays(res.jailMs)}.`, mentions: jids })
        } catch {}
      }, 2 * MIN)
      await m.reply(`🕶️ *NETWORK HEIST PLANNED* by @${me}\n\nNeed 3 people in total. Join with *.gheist join* in the next 2 minutes!\nLoot is split between everyone, but if it fails everyone goes to network jail.`, { mentions: [m.sender] })
    }
  },
  {
    name: 'gblackjack',
    aliases: ['gbj', 'nblackjack'],
    desc: 'Network blackjack vs the bot: .gblackjack 500, then .ghit / .gstand',
    category: CAT,
    async run(sock, m, { args }) {
      if (!gate(sock, m)) return
      const sub = (args[0] || '').toLowerCase()
      const me = myNumber(sock)
      let res
      if (sub === 'hit') res = await net.bjHit(me)
      else if (sub === 'stand') res = await net.bjStand(me)
      else {
        const bet = parseInt((args[0] || '').replace(/,/g, ''), 10)
        if (!bet || bet < 50) return m.reply('Example: .gblackjack 500 (min 50, max 5,000)')
        res = await net.bjStart(me, bet)
      }
      if (!res.ok) return failed(m, res, { NO_GAME: 'You have no blackjack game. Start with .gblackjack <amount>', GAME_EXISTS: 'You are already playing. Use .ghit or .gstand' })
      const dealer = `${(res.dealer || []).join(' ')}${res.state === 'playing' ? ' ❓' : ''}${res.dealerValue != null && res.state !== 'playing' ? ` (${res.dealerValue})` : ''}`
      const you = `${(res.player || []).join(' ')} (${res.playerValue})`
      let head = '.ghit or .gstand'
      if (res.state !== 'playing') {
        head = { bust: `💥 Bust! You lost 💰${fmt(res.bet)}.`, win: `🎉 You win 💰${fmt(res.bet)}!`, draw: `🤝 Draw, your 💰${fmt(res.bet)} is refunded.`, lose: `😔 Dealer wins. You lost 💰${fmt(res.bet)}.` }[res.result] || 'Game over.'
        head += `\nBalance: 💰${fmt(res.balance)}`
      }
      await m.reply(`🃏 *NETWORK BLACKJACK*\nYou: ${you}\nDealer: ${dealer}\n\n${head}`)
    }
  },
  {
    name: 'ghit',
    aliases: ['nhit'],
    desc: 'Network blackjack: draw a card',
    category: CAT,
    async run(sock, m, ctx) {
      return module.exports.find((c) => c.name === 'gblackjack').run(sock, m, { ...ctx, args: ['hit'] })
    }
  },
  {
    name: 'gstand',
    aliases: ['nstand'],
    desc: 'Network blackjack: keep your hand',
    category: CAT,
    async run(sock, m, ctx) {
      return module.exports.find((c) => c.name === 'gblackjack').run(sock, m, { ...ctx, args: ['stand'] })
    }
  },
  {
    name: 'glottery',
    aliases: ['nlottery'],
    desc: 'Network lottery, one shared pot for everyone: .glottery [tickets] | .glottery info',
    category: CAT,
    async run(sock, m, { args }) {
      if (!gate(sock, m)) return
      const me = myNumber(sock)
      const showDraw = async (d) => {
        if (d) await sock.sendMessage(m.chat, { text: `🎟️ *NETWORK LOTTERY DRAW*\n\nThe pot of 💰${fmt(d.pot)} goes to @${d.winner}! 🎉\n(${d.tickets} ticket${d.tickets === 1 ? '' : 's'} were sold)`, mentions: [fn.toJid(d.winner)] }).catch(() => {})
      }
      if ((args[0] || '').toLowerCase() === 'info') {
        const res = await net.lotteryInfo(me)
        if (!res.ok) return failed(m, res)
        await showDraw(res.drawn)
        if (!res.pot) return m.reply('🎟️ No tickets sold yet. Buy the first one with .glottery')
        return m.reply(`🎟️ *NETWORK LOTTERY*\nPot: 💰${fmt(res.pot)}\nTickets: ${res.tickets}\nYours: ${res.yours}\nDraw in: ${left(res.drawAt - Date.now())}`)
      }
      const n = Math.min(10, Math.max(1, parseInt(args[0], 10) || 1))
      const res = await net.lotteryBuy(me, n)
      if (!res.ok) return failed(m, res, { INSUFFICIENT_FUNDS: `A ticket costs 💰200. You need 💰${fmt(200 * n)}.` })
      await showDraw(res.drawn)
      await m.reply(`🎟️ Bought ${n} ticket${n > 1 ? 's' : ''}!\nPot: 💰${fmt(res.pot)} • Your tickets: ${res.yours}\nDraw in ${left(res.drawAt - Date.now())}. Good luck! 🍀`)
    }
  }
]
module.exports.push(...extraCommands)
