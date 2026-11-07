// .premium  : status, or restore a Premium ID  (.premium id:GID-747493)
// .subscribe: start a Paystack checkout (only when the admin switched subscriptions + Paystack on)
// Both are FREE commands and always work, including in Free Mode, where they just explain that Premium is unavailable.
// Nothing here decides who is premium: every answer comes from the Global Gideon Network server.
const premium = require('../premium')
const net = require('../network')
const store = require('../store')
const config = require('../config')

const CAT = 'general'
const polling = new Set()

function who(m) { return m.isMainOwner }

// GID-XXXX-XXXX-XXXX (new) or GID-123456 (old IDs stay valid), typed with or without the dashes
function parseId(text) {
  const t = String(text || '')
  const long = t.match(/gid-?([a-z2-9]{4})-?([a-z2-9]{4})-?([a-z2-9]{4})(?![a-z0-9])/i)
  if (long) return `GID-${long[1]}-${long[2]}-${long[3]}`.toUpperCase()
  const old = t.match(/gid-?(\d{6})(?!\d)/i)
  return old ? `GID-${old[1]}` : null
}

// the plan list people see for .subscribe; plans come from the admin dashboard (Subscription Settings > Plans)
const onSale = (plans) => (plans || []).filter((p) => p.amountNaira > 0)
const naira = (n) => `₦${Number(n).toLocaleString('en-US')}`
function planList(plans, prefix, canPay) {
  const rows = onSale(plans).map((p, i) => `┃  ┃  ${i + 1}. ${`${p.days} DAY${p.days === 1 ? '' : 'S'}`.padEnd(8)} ┃ ${naira(p.amountNaira)}`)
  return [
    '╭━━━〔 👑 GIDEON PREMIUM 〕━━━╮',
    '┃',
    '┃  💎 PREMIUM SUBSCRIPTION',
    '┃',
    '┃  ┏━━━━━━━━━━━━━━━━━━┓',
    '┃  ┃  ⏳ DURATION  ┃  PRICE',
    '┃  ┣━━━━━━━━━━━━━━━━━━┫',
    ...rows,
    '┃  ┗━━━━━━━━━━━━━━━━━━┛',
    '┃',
    '┃  🔥 UNLOCK GIDEON PREMIUM',
    '┃  🚀 Access exclusive commands',
    '┃  ⚡ Upgrade your experience',
    '┃',
    ...(canPay ? ['┃  💳 PAY & UNLOCK PREMIUM', `┃  👉 ${prefix}subscribe <number>  (example: ${prefix}subscribe 1)`] : []),
    '┃  📩 Contact Owner for Subscription',
    '┃',
    '╰━━━━━━━━━━━━━━━━━━━━━━╯',
    '       ⚡ POWERED BY GPRAISE',
    '       CODE. CREATE. DOMINATE.'
  ].join('\n')
}

module.exports = [
  {
    name: 'premium',
    aliases: ['gid', 'myplan'],
    desc: 'Show your Gideon Premium status, or restore an ID: .premium id:GID-ABCD-EFGH-JKLM',
    category: CAT,
    owner: true,
    async run(sock, m, { text, prefix }) {
      if (!who(m)) return m.reply('Only the main owner of this Gideon installation can manage Premium.')
      await premium.refreshPolicy(true).catch(() => {})
      const s = premium.state.settings
      const pid = parseId(text)

      if (/\bid\b/i.test(text) || pid) {
        if (!pid) return m.reply(`Example: ${prefix}premium id:GID-ABCD-EFGH-JKLM`)
        if (!s.subscriptionEnabled) return m.reply(s.freeModeMessage)
        const id = await premium.ensureInstall(null, sock)
        if (!id) return m.reply('Could not reach the Gideon network right now. Try again shortly.')
        const r = await net.premiumClaim(id.installId, id.token, sock.isCloud ? String(sock.user?.id || '').split(':')[0] : config.ownerNumber, pid)
        if (r.ok && r.active) {
          await premium.refreshEntitlement(true, sock)
          return m.reply(`Premium restored.\nID: ${pid}\nExpires: ${new Date(r.expiresAt).toDateString()} (${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left)${r.rebound ? '\nThis ID was moved to this WhatsApp number.' : ''}\n${sock.isCloud ? 'People you pair share it.' : 'Paired numbers on this installation share it.'}\nIt works on one WhatsApp at a time. To use it on another number, log that one out (or delete its bot) first, then run ${prefix}premium id:${pid} there.`)
        }
        if (r.ok) return m.reply(`That ID was accepted but is not active (${String(r.reason || 'inactive').toLowerCase()}).`)
        const msg = {
          INVALID_ID: 'That Premium ID is not valid.',
          REVOKED: 'That Premium ID has been revoked.',
          IN_USE: 'That Premium ID is being used on another WhatsApp right now.\nA Premium ID works on one WhatsApp at a time. Log that WhatsApp out (or delete its bot) and try again. If it is simply offline, it frees itself about 12 minutes after it was last online.',
          RATE_LIMITED: 'Too many attempts. Try again later.'
        }
        return m.reply(msg[r.error] || `Could not check that ID right now (${r.error}).`)
      }

      if (!s.subscriptionEnabled) return m.reply(`${s.freeModeMessage}\n\nFree commands, the economy and fun commands all work normally.`)
      const id = await premium.ensureInstall(null, sock)
      if (!id) return m.reply('Could not reach the Gideon network right now. Try again shortly.')
      const r = await net.premiumStatus(id.installId, id.token)
      if (!r.ok) return m.reply(`Could not check Premium right now (${r.error}).`)
      if (r.active) return m.reply(`Gideon Premium: ACTIVE\nID: ${r.premiumId}\nExpires: ${new Date(r.expiresAt).toDateString()} (${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left)\n\nKeep your ID safe. Restore it any time with ${prefix}premium id:${r.premiumId}`)
      const how = r.payments ? `Subscribe with ${prefix}subscribe <plan> <your email>.` : 'Payments are not available yet.'
      if (r.reason === 'REBOUND') return m.reply(`This WhatsApp is no longer using Premium: the ID moved to another number.\nTo take it back, log the other one out and run ${prefix}premium id:GID-ABCD-EFGH-JKLM here.`)
      return m.reply(`Gideon Premium: ${r.reason === 'EXPIRED' ? `EXPIRED (${r.premiumId})` : 'not active'}\n${how}\nAlready have an ID? ${prefix}premium id:GID-ABCD-EFGH-JKLM`)
    }
  },
  {
    name: 'subscribe',
    aliases: ['buypremium', 'upgrade-premium'],
    desc: 'See the Premium plans (.subscribe) and pay: .subscribe 1',
    category: CAT,
    owner: true,
    async run(sock, m, { args, prefix }) {
      if (!who(m)) return m.reply('Only the main owner of this Gideon installation can manage Premium.')
      await premium.refreshPolicy(true).catch(() => {})
      const s = premium.state.settings
      if (!s.subscriptionEnabled) return m.reply(s.freeModeMessage) // no payment prompt in Free Mode
      const id = await premium.ensureInstall(null, sock)
      if (!id) return m.reply('Could not reach the Gideon network right now. Try again shortly.')
      const st = await net.premiumStatus(id.installId, id.token)
      if (!st.ok) return m.reply(`Could not reach the payment service (${st.error}).`)
      const plans = onSale(st.plans)
      const email = args.find((a) => /@/.test(a))
      const pick = args.find((a) => a !== email)
      if (!pick) {
        if (!plans.length) return m.reply('No plan is on sale right now. Contact the owner for a subscription.')
        return sock.sendMessage(m.chat, { text: planList(st.plans, prefix, !!st.payments) }, { skipStyle: true })
      }
      if (!st.payments) return m.reply('Payments are not available yet. Contact the owner for a subscription.')
      // .subscribe 1 = first plan in the list (a plan id such as d7 works too)
      const plan = /^\d+$/.test(pick) ? plans[Number(pick) - 1] : plans.find((p) => p.id === pick.toLowerCase())
      if (!plan) return m.reply(`There is no plan "${pick}". Send ${prefix}subscribe to see the plans and pick a number.`)
      const r = await net.premiumCheckout(id.installId, id.token, plan.id, email || '')
      if (!r.ok) return m.reply(r.message || `Could not start the payment (${r.error}).`)
      await m.reply(`Pay securely with Paystack:\n${r.url}\n\n${r.plan} - ₦${r.amountNaira.toLocaleString()}\nI will message you your Premium ID as soon as the payment is confirmed. You can also check with ${prefix}premium.`)

      if (polling.has(r.reference)) return
      polling.add(r.reference)
      const dm = sock.getOwnerJid()
      let tries = 0
      const timer = setInterval(async () => {
        tries++
        try {
          const p = await net.premiumPayment(id.installId, id.token, r.reference)
          if (p.ok && p.status === 'success') {
            clearInterval(timer); polling.delete(r.reference)
            await premium.refreshEntitlement(true, sock)
            await sock.sendMessage(dm, { text: `Payment confirmed.\n\nYour Gideon Premium ID: ${p.premiumId}\nValid until: ${new Date(p.expiresAt).toDateString()}\n\nKeep it safe. If you ever move hosts, restore it with ${prefix}premium id:${p.premiumId}` }, { skipStyle: true })
          } else if (p.ok && ['failed', 'abandoned', 'reversed', 'mismatch'].includes(p.status)) {
            clearInterval(timer); polling.delete(r.reference)
            await sock.sendMessage(dm, { text: `The payment ${r.reference} did not complete (${p.status}). Nothing was charged for Premium. Try ${prefix}subscribe again.` }, { skipStyle: true })
          }
        } catch {}
        if (tries >= 60) { clearInterval(timer); polling.delete(r.reference) } // ~20 minutes, then ".premium" still shows the result
      }, 20000)
      timer.unref?.()
    }
  }
]
