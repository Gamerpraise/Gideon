// .subscribe shows the plan list, .subscribe <number> sends the payment link; long Premium IDs are understood. No network.
const ROOT = require('path').join(__dirname, '..'); process.chdir(ROOT)
require(require('path').join(ROOT, 'tests/stub-missing-modules.js'))
const assert = require('assert'), path = require('path')
const premium = require(path.join(ROOT, 'premium')), net = require(path.join(ROOT, 'network'))
const cmds = [].concat(require(path.join(ROOT, 'commands/premium.js')))
const sub = cmds.find((c) => c.name === 'subscribe'), prem = cmds.find((c) => c.name === 'premium')
const plans = [{ id: 'd3', name: '3d', days: 3, amountNaira: 500 }, { id: 'd7', name: '7d', days: 7, amountNaira: 1000 }, { id: 'free', name: 'x', days: 1, amountNaira: 0 }, { id: 'd14', name: '14d', days: 14, amountNaira: 1800 }, { id: 'd30', name: '30d', days: 30, amountNaira: 3000 }]
let checkout = null, claimed = null, payments = true
premium.refreshPolicy = async () => { premium.state.settings.subscriptionEnabled = true }
premium.ensureInstall = async () => ({ installId: 'inst_t', token: 'tok' })
premium.refreshEntitlement = async () => ({})
net.premiumStatus = async () => ({ ok: true, payments, plans })
net.premiumCheckout = async (i, t, plan, email) => { checkout = { plan, email }; return { ok: true, reference: 'GDN_x', url: 'https://checkout.paystack.com/abc', plan: 'Gideon Premium', amountNaira: 1000 } }
net.premiumPayment = async () => ({ ok: true, status: 'pending' })
net.premiumClaim = async (i, t, n, id) => { claimed = id; return { ok: true, active: true, expiresAt: Date.now() + 864e5, daysLeft: 1 } }
const run = async (cmd, args, extra = {}) => { const out = []; const sock = { isCloud: false, user: { id: '1:1@s.whatsapp.net' }, getOwnerJid: () => 'me@s.whatsapp.net', sendMessage: async (c, x) => out.push(x.text), ...extra }
  await cmd.run(sock, { isMainOwner: true, chat: 'c', reply: async (x) => out.push(x) }, { args, text: args.join(' '), prefix: '.' }); return out }
;(async () => {
  let out = await run(sub, [])
  const list = out[0]
  assert(list.includes('👑 GIDEON PREMIUM') && list.includes('⚡ POWERED BY GPRAISE') && list.includes('CODE. CREATE. DOMINATE.'))
  assert(/1\. 3 DAYS\s+┃ ₦500/.test(list) && /2\. 7 DAYS\s+┃ ₦1,000/.test(list) && /3\. 14 DAYS\s+┃ ₦1,800/.test(list) && /4\. 30 DAYS\s+┃ ₦3,000/.test(list), 'plans numbered, free (price 0) plan hidden')
  assert(list.includes('.subscribe <number>') && list.includes('Contact Owner for Subscription'))
  payments = false; out = await run(sub, []); assert(!out[0].includes('PAY & UNLOCK') && out[0].includes('Contact Owner'), 'no pay line while payments are off'); payments = true
  out = await run(sub, ['2']); assert.deepStrictEqual(checkout, { plan: 'd7', email: '' }); assert(out[0].includes('https://checkout.paystack.com/abc'))
  out = await run(sub, ['4', 'me@mail.com']); assert.deepStrictEqual(checkout, { plan: 'd30', email: 'me@mail.com' })
  out = await run(sub, ['9']); assert(/no plan "9"/i.test(out[0]))
  out = await run(sub, ['d14']); assert.strictEqual(checkout.plan, 'd14')
  await run(prem, ['id:gid-abcd-efgh-jkmn']); assert.strictEqual(claimed, 'GID-ABCD-EFGH-JKMN')
  await run(prem, ['id:GIDABCDEFGHJKMN']); assert.strictEqual(claimed, 'GID-ABCD-EFGH-JKMN')
  await run(prem, ['id:GID-747493']); assert.strictEqual(claimed, 'GID-747493', 'old IDs still work')
  console.log(list.split('\n').slice(0, 12).join('\n')); console.log('subscribe OK'); process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
