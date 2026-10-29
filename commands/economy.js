const levels = require('../levels')
const store = require('../store')
const fn = require('../functions')

const fmt = (n) => Number(n).toLocaleString('en-US')
const jobs = ['fixed a website', 'delivered packages', 'sold phone cases', 'tutored a student', 'edited a video', 'washed cars', 'designed a logo']
const lastGamble = new Map()

function target(m) {
  return m.quoted?.sender || m.mentionedJid?.[0] || null
}

module.exports = [
  {
    name: 'rank',
    aliases: ['level', 'xp', 'profile'],
    desc: 'Your level, XP and coins',
    category: 'fun',
    async run(sock, m) {
      const who = target(m) || m.sender
      const num = fn.cleanJid(who)
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
    aliases: ['leaderboard', 'lb'],
    desc: 'Top 10 most active members of this group',
    category: 'fun',
    group: true,
    async run(sock, m) {
      const gx = store.get().gxp?.[m.chat] || {}
      const top = Object.entries(gx).sort((a, b) => b[1] - a[1]).slice(0, 10)
      if (!top.length) return m.reply('No activity recorded here yet. Start chatting.')
      const medals = ['1.', '2.', '3.']
      const lines = top.map(([id, xp], i) => `${medals[i] || `${i + 1}.`} @${id} • level ${levels.levelOf(xp)} • ${fmt(xp)} xp`)
      await m.reply(`Top members\n\n${lines.join('\n')}`, { mentions: top.map(([id]) => `${id}@s.whatsapp.net`) })
    }
  },
  {
    name: 'daily',
    desc: 'Claim your daily coins (streak gives more)',
    category: 'fun',
    async run(sock, m) {
      const u = levels.user(fn.cleanJid(m.sender))
      const now = Date.now()
      const wait = 24 * 3600 * 1000 - (now - u.lastDaily)
      if (wait > 0) return m.reply(`Come back in ${fn.runtime(wait / 1000)}.`)
      u.streak = now - u.lastDaily < 48 * 3600 * 1000 ? Math.min(u.streak + 1, 7) : 1
      const gain = 500 + (u.streak - 1) * 100
      u.coins += gain
      u.lastDaily = now
      store.save()
      await m.reply(`Daily claimed: +${fmt(gain)} coins\nStreak ${u.streak} day(s)\nBalance ${fmt(u.coins)}`)
    }
  },
  {
    name: 'work',
    desc: 'Work for coins (once an hour)',
    category: 'fun',
    async run(sock, m) {
      const u = levels.user(fn.cleanJid(m.sender))
      const wait = 3600 * 1000 - (Date.now() - u.lastWork)
      if (wait > 0) return m.reply(`You are tired. Rest ${fn.runtime(wait / 1000)} more.`)
      const gain = 50 + Math.floor(Math.random() * 250)
      u.coins += gain
      u.lastWork = Date.now()
      store.save()
      await m.reply(`You ${fn.pickRandom(jobs)} and earned ${fmt(gain)} coins.\nBalance ${fmt(u.coins)}`)
    }
  },
  {
    name: 'balance',
    aliases: ['bal', 'wallet', 'coins'],
    desc: 'Show your coins',
    category: 'fun',
    async run(sock, m) {
      const who = target(m) || m.sender
      await m.reply(`@${fn.cleanJid(who)} has ${fmt(levels.user(fn.cleanJid(who)).coins)} coins`, { mentions: [who] })
    }
  },
  {
    name: 'gamble',
    aliases: ['bet'],
    desc: 'Bet coins: .gamble 100 (45% to double)',
    category: 'fun',
    async run(sock, m, { args }) {
      const num = fn.cleanJid(m.sender)
      const u = levels.user(num)
      const bet = args[0] === 'all' ? u.coins : parseInt(args[0])
      if (!bet || bet < 10) return m.reply('Example: .gamble 100 (minimum 10)')
      if (bet > u.coins) return m.reply(`You only have ${fmt(u.coins)} coins.`)
      if (Date.now() - (lastGamble.get(num) || 0) < 8000) return m.reply('Slow down, wait a few seconds.')
      lastGamble.set(num, Date.now())
      const won = Math.random() < 0.45
      u.coins += won ? bet : -bet
      store.save()
      await m.reply(won ? `You won ${fmt(bet)} coins!\nBalance ${fmt(u.coins)}` : `You lost ${fmt(bet)} coins.\nBalance ${fmt(u.coins)}`)
    }
  },
  {
    name: 'give',
    aliases: ['pay', 'transfer'],
    desc: 'Send coins: .give @user 100',
    category: 'fun',
    async run(sock, m, { args }) {
      const to = target(m)
      const amount = parseInt(args.find((a) => /^\d+$/.test(a)))
      if (!to || !amount || amount < 1) return m.reply('Example: .give @user 100 (or reply with .give 100)')
      const from = levels.user(fn.cleanJid(m.sender))
      if (fn.cleanJid(to) === fn.cleanJid(m.sender)) return m.reply('You cannot pay yourself.')
      if (amount > from.coins) return m.reply(`You only have ${fmt(from.coins)} coins.`)
      from.coins -= amount
      levels.user(fn.cleanJid(to)).coins += amount
      store.save()
      await m.reply(`Sent ${fmt(amount)} coins to @${fn.cleanJid(to)}`, { mentions: [to] })
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
  }
]
