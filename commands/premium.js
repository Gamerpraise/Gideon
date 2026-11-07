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

module.exports = [
  {
    name: 'premium',
    aliases: ['gid', 'myplan'],
    desc: 'Show your Gideon Premium status, or restore an ID: .premium id:GID-123456',
    category: CAT,
    owner: true,
    async run(sock, m, { text, prefix }) {
      if (!who(m)) return m.reply('Only the main owner of this Gideon installation can manage Premium.')
      await premium.refreshPolicy(true).catch(() => {})
      const s = premium.state.settings
      const idMatch = String(text || '').match(/gid-?(\d{6})/i)

      if (/\bid\b/i.test(text) || idMatch) {
        if (!idMatch) return m.reply(`Example: ${prefix}premium id:GID-123456`)
        if (!s.subscriptionEnabled) return m.reply(s.freeModeMessage)
        const id = await premium.ensureInstall(null, sock)
        if (!id) return m.reply('Could not reach the Gideon network right now. Try again shortly.')
        const r = await net.premiumClaim(id.installId, id.token, sock.isCloud ? String(sock.user?.id || '').split(':')[0] : config.ownerNumber, `GID-${idMatch[1]}`)
        if (r.ok && r.active) {
          await premium.refreshEntitlement(true, sock)
          return m.reply(`Premium restored.\nID: GID-${idMatch[1]}\nExpires: ${new Date(r.expiresAt).toDateString()} (${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left)${r.rebound ? '\nThis ID was moved to this WhatsApp number.' : ''}\n${sock.isCloud ? 'People you pair share it.' : 'Paired numbers on this installation share it.'}\nIt works on one WhatsApp at a time. To use it on another number, log that one out (or delete its bot) first, then run ${prefix}premium id:GID-${idMatch[1]} there.`)
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
      if (r.reason === 'REBOUND') return m.reply(`This WhatsApp is no longer using Premium: the ID moved to another number.\nTo take it back, log the other one out and run ${prefix}premium id:GID-123456 here.`)
      return m.reply(`Gideon Premium: ${r.reason === 'EXPIRED' ? `EXPIRED (${r.premiumId})` : 'not active'}\n${how}\nAlready have an ID? ${prefix}premium id:GID-123456`)
    }
  },
  {
    name: 'subscribe',
    aliases: ['buypremium', 'upgrade-premium'],
    desc: 'Pay for Gideon Premium: .subscribe <plan> <email>',
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
      if (!st.payments) return m.reply('Payments are not available yet.')
      const email = args.find((a) => /@/.test(a))
      const plan = args.find((a) => a !== email) || st.plans[0]?.id
      if (!email) {
        const list = st.plans.filter((p) => p.amountNaira > 0).map((p) => `• ${p.id}: ${p.name} for ₦${p.amountNaira.toLocaleString()}`).join('\n')
        return m.reply(`Plans:\n${list || 'No plan is on sale right now.'}\n\nExample: ${prefix}subscribe ${st.plans[0]?.id || 'monthly'} you@example.com`)
      }
      const r = await net.premiumCheckout(id.installId, id.token, plan, email)
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
