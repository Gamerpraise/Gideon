// Server-side platform tests. Run:  node tests/platform.test.js     (no network, no Firebase, no Express needed)
const ADMIN = 'gamerpraisemoder@gmail.com'
process.env.SECRETS_KEY = 'test-secrets-key-0123456789abcdef'
process.env.SESSION_SECRET = 'test-session-secret'
const assert = require('assert')
const crypto = require('crypto')
const path = require('path')
const { FakeDb, makeApp } = require('./fakes')
const SERVER = path.join(__dirname, '..', 'Global-Gideon-server-main')
const core = require(path.join(SERVER, 'platform', 'core'))
const mountPlatform = require(path.join(SERVER, 'platform'))
const filesMod = require(path.join(SERVER, 'platform', 'files'))

// ---- Paystack mock (global fetch) -------------------------------------------------------------
const SK = 'sk_test_abcdef123456'
const paystack = { paid: {}, calls: [], amountOverride: null }
// ---- Firebase Authentication mock: identitytoolkit REST + Admin SDK verifyIdToken ----------------
const fb = { users: {}, calls: [], mails: [] }
const fbJson = (j, status = 200) => ({ ok: status < 400, status, json: async () => j })
async function firebaseFetch(u, opts) {
  const body = JSON.parse(opts.body || '{}'); const ep = u.pathname.split('/').pop(); fb.calls.push({ ep, email: body.email })
  if (u.searchParams.get('key') !== 'test-web-api-key') return fbJson({ error: { message: 'API_KEY_INVALID' } }, 400)
  if (ep === 'accounts:signUp') { if (fb.users[body.email]) return fbJson({ error: { message: 'EMAIL_EXISTS' } }, 400); fb.users[body.email] = { password: body.password, verified: false }; return fbJson({ idToken: `tok|${body.email}` }) }
  if (ep === 'accounts:signInWithPassword') { const x = fb.users[body.email]; if (!x || x.password !== body.password) return fbJson({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400); return fbJson({ idToken: `tok|${body.email}` }) }
  if (ep === 'accounts:sendOobCode') { fb.mails.push(body.requestType); return fbJson({ email: body.email || 'x' }) }
  return fbJson({ error: { message: 'NOPE' } }, 400)
}
const fakeAdminSdk = { auth: () => ({ verifyIdToken: async (tok) => { const [pre, email] = String(tok).split('|'); if (pre !== 'tok' || !fb.users[email]) throw new Error('bad token'); return { email, email_verified: !!fb.users[email].verified } } }) }

global.fetch = async (url, opts = {}) => {
  const u = new URL(url)
  if (u.hostname === 'identitytoolkit.googleapis.com') return firebaseFetch(u, opts)
  paystack.calls.push(u.pathname)
  const ok = (j, status = 200) => ({ ok: status < 400, status, json: async () => j })
  if (opts.headers?.Authorization !== `Bearer ${SK}`) return ok({ status: false, message: 'Invalid key' }, 401)
  if (u.pathname === '/transaction/totals') return ok({ status: true, data: {} })
  if (u.pathname === '/transaction/initialize') { const b = JSON.parse(opts.body); paystack.last = b; paystack.paid[b.reference] = { amount: b.amount, currency: b.currency }; return ok({ status: true, data: { authorization_url: 'https://checkout.paystack.com/' + b.reference, reference: b.reference } }) }
  const m = u.pathname.match(/^\/transaction\/verify\/(.+)$/)
  if (m) { const p = paystack.paid[decodeURIComponent(m[1])]; return p && p.settled ? ok({ status: true, data: { status: 'success', amount: paystack.amountOverride ?? p.amount, currency: p.currency, id: 99 } }) : ok({ status: true, data: { status: 'abandoned' } }) }
  return ok({ status: false, message: 'nope' }, 404)
}

let passed = 0, failed = 0
const results = []
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]) } catch (e) { failed++; results.push(['FAIL', name, e.message]) } }

;(async () => {
  const db = new FakeDb()
  const app = makeApp()
  const players = db.collection('players')
  // a fake economy route behind the platform guard (stands in for server.js / economy.js)
  let workCalls = 0
  const plat = mountPlatform(app, { db, players, admin: fakeAdminSdk })
  app.post('/work', (req, res) => { workCalls++; res.json({ ok: true, earned: 100, balance: 600 }) })
  app.get('/balance/:n', (req, res) => res.json({ ok: true, balance: 500 }))
  app.post('/join', (req, res) => res.json({ ok: true }))
  await plat.ready

  const R = (m, u, body, headers) => app.request(m, u, { body, headers })
  const session = (idToken, ip) => (ip ? app.request('POST', '/admin/api/auth/session', { body: { idToken }, ip }) : R('POST', '/admin/api/auth/session', { idToken }))
  let H, A, login
  // ---------------------------------------------------------------- admin auth (Firebase SDK in the browser, ID token verified here)
  fb.users[ADMIN] = { password: 'x', verified: false }; fb.users['other@x.com'] = { password: 'x', verified: true }
  await t('there is no admin password anywhere and the server never sees a password (no password login routes exist)', async () => {
    assert.strictEqual(process.env.ADMIN_PASSWORD, undefined)
    for (const u of ['/admin/api/login', '/admin/api/auth/login', '/admin/api/auth/signup']) assert.notStrictEqual((await R('POST', u, { email: ADMIN, password: 'x', idToken: 'x' })).status, 200, u)
  })
  await t('admin API refuses requests without a session', async () => assert.strictEqual((await R('GET', '/admin/api/settings')).status, 401))
  await t('ping tells the dashboard a server is hosting it', async () => assert.strictEqual((await R('GET', '/admin/api/ping')).body.hosted, true))
  await t('session: missing / garbage Firebase token refused', async () => { assert.strictEqual((await session('')).status, 400); assert.strictEqual((await session('garbage')).status, 401) })
  await t('session: a verified Firebase account with a DIFFERENT email is refused (and logged)', async () => { assert.strictEqual((await session('tok|other@x.com')).status, 403) })
  await t('session: the admin email with an UNVERIFIED address is refused (nobody can squat your email)', async () => { const r = await session('tok|' + ADMIN); assert.strictEqual(r.status, 403); assert.match(r.body.error, /Verify your email/) })
  await t('session: verified admin email gets a session', async () => { fb.users[ADMIN].verified = true; login = await session('tok|' + ADMIN); assert.strictEqual(login.status, 200); assert.ok(login.body.token); H = { authorization: 'Bearer ' + login.body.token }; A = (m, u, body) => R(m, '/admin/api' + u, body, H) })
  await t('session: email comparison is case-insensitive but exact (no look-alikes)', async () => { fb.users['GamerPraiseModer@gmail.com'.toLowerCase()] = fb.users[ADMIN]; fb.users['gamerpraisemoder@gmail.com.evil.com'] = { verified: true }; assert.strictEqual((await session('tok|gamerpraisemoder@gmail.com.evil.com')).status, 403); assert.strictEqual((await session('tok|gamerpraisemoder+x@gmail.com')).status, 401) })
  await t('session works and /me reports the admin email', async () => assert.strictEqual((await A('GET', '/me')).body.email, ADMIN))
  await t('forged or tampered session tokens are rejected', async () => { for (const tok of ['eyJleHAiOjk5OTk5OTk5OTk5OTl9.forged', login.body.token.slice(0, -3) + 'abc', 'x']) assert.strictEqual((await R('GET', '/admin/api/settings', null, { authorization: 'Bearer ' + tok })).status, 401) })
  await t('a correctly signed session for any other email is rejected', async () => assert.strictEqual((await R('GET', '/admin/api/settings', null, { authorization: 'Bearer ' + core.makeSession('other@x.com') })).status, 401))
  await t('session exchange is rate limited', async () => { let last; for (let i = 0; i < 15; i++) last = await session('garbage', '9.9.9.9'); assert.strictEqual(last.status, 429) })
  await t('failed and denied sign-ins are in the audit log', async () => { const l = (await A('GET', '/logs?limit=300')).body.logs.map((x) => x.action); assert.ok(l.includes('login.denied') && l.includes('login.failed') && l.includes('login.ok')) })
  const reg = async (owner = '2348000000001') => (await R('POST', '/install/register', { ownerNumber: owner, accounts: [owner], version: '3.1.0' })).body
  const authz = async (inst, command) => (await R('POST', '/premium/authorize', { installId: inst.installId, token: inst.token, command })).body
  const setSettings = (p) => A('PUT', '/settings', p)
  await t('dashboard page and its artwork are served without a session, API data is not', async () => { assert.strictEqual((await R('GET', '/admin')).body, 'FILE'); assert.strictEqual((await R('GET', '/admin/assets/banner.jpg')).body, 'FILE'); assert.strictEqual((await R('GET', '/admin/assets/secret.txt')).status, 404); assert.strictEqual((await R('GET', '/admin/api/overview')).status, 401) })
  await t('banner upload: only real image data URLs, size capped, reset works', async () => {
    assert.strictEqual((await A('PUT', '/branding', { bannerDataUrl: 'javascript:alert(1)' })).status, 400)
    assert.strictEqual((await A('PUT', '/branding', { bannerDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' })).status, 400)
    assert.strictEqual((await A('PUT', '/branding', { bannerDataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(900001) })).status, 400)
    const ok = 'data:image/png;base64,iVBORw0KGgo='
    assert.strictEqual((await A('PUT', '/branding', { bannerDataUrl: ok })).status, 200); assert.strictEqual((await A('GET', '/branding')).body.bannerDataUrl, ok)
    assert.strictEqual((await R('GET', '/admin/api/branding')).status, 401)
    assert.strictEqual((await A('DELETE', '/branding')).status, 200); assert.strictEqual((await A('GET', '/branding')).body.bannerDataUrl, null)
  })
  await t('overview exposes the dashboard fields (uptime, version, paystack state)', async () => { const o = (await A('GET', '/overview')).body; assert.ok(o.uptimeSec >= 0 && o.serverVersion && o.paystack === 'not configured') })


  // ---------------------------------------------------------------- Free Mode
  const inst = await reg()
  await t('default is FREE MODE (subscriptions off)', async () => assert.strictEqual((await A('GET', '/settings')).body.settings.subscriptionEnabled, false))
  await t('Free Mode: premium commands are OPEN to everyone (no subscription needed)', async () => {
    for (const c of ['gideonai', 'imagine', 'removebg']) { const r = await authz(inst, c); assert.strictEqual(r.allow, true, c); assert.strictEqual(r.tier, 'FREE_MODE', c) }
  })
  await t('Free Mode + Global Premium Commands switch OFF: premium commands blocked for everyone', async () => {
    await setSettings({ premiumCommandsEnabled: false }); const r = await authz(inst, 'gideonai'); assert.strictEqual(r.allow, false); assert.strictEqual(r.code, 'PREMIUM_OFF'); await setSettings({ premiumCommandsEnabled: true })
  })
  await t('Free Mode: free management command allowed', async () => assert.strictEqual((await authz(inst, 'lock')).allow, true))
  await t('Free Mode: economy command allowed (local + global names)', async () => { assert.strictEqual((await authz(inst, 'balance')).allow, true); assert.strictEqual((await authz(inst, 'gbalance')).allow, true) })
  await t('Free Mode: fun command allowed', async () => assert.strictEqual((await authz(inst, 'joke')).allow, true))
  await t('Free Mode: checkout refused, answers with Free Mode message', async () => { const r = (await R('POST', '/premium/checkout', { installId: inst.installId, token: inst.token, plan: 'monthly', email: 'a@b.co' })).body; assert.strictEqual(r.ok, false); assert.strictEqual(r.error, 'FREE_MODE') })
  await t('Free Mode: economy endpoints still work through the guard', async () => { const r = await R('POST', '/work', { number: '1' }); assert.strictEqual(r.body.ok, true) })

  // ---------------------------------------------------------------- restricted
  await t('restricted commands (vv, vv2, antidelete) are blocked in every mode', async () => {
    await setSettings({ subscriptionEnabled: true })
    for (const c of ['vv', 'vv2', 'antidelete', 'stealvv', 'viewonce']) { const r = await authz(inst, c); assert.strictEqual(r.allow, false, c); assert.strictEqual(r.code, 'RESTRICTED', c) }
    await setSettings({ subscriptionEnabled: false })
  })
  await t('restricted commands cannot be switched on or made FREE from the dashboard', async () => {
    assert.strictEqual((await A('PUT', '/commands/vv2', { enabled: true, tier: 'FREE' })).status, 400)
    assert.strictEqual((await authz(inst, 'vv2')).code, 'RESTRICTED')
  })

  // ---------------------------------------------------------------- Premium Mode, Paystack not configured
  await t('Premium Mode ON: free commands still work', async () => { await setSettings({ subscriptionEnabled: true }); for (const c of ['lock', 'balance', 'joke']) assert.strictEqual((await authz(inst, c)).allow, true, c) })
  await t('Premium Mode ON, no subscription: premium command blocked (NOT_PREMIUM)', async () => { const r = await authz(inst, 'gideonai'); assert.strictEqual(r.allow, false); assert.strictEqual(r.code, 'NOT_PREMIUM') })
  await t('paid-only ignored while subscriptions are OFF', async () => { await setSettings({ subscriptionEnabled: false, paidOnlyMode: true }); assert.strictEqual((await authz(inst, 'joke')).allow, true); await setSettings({ subscriptionEnabled: true }) })
  await t('Paid-only + Premium Mode: whole bot needs Premium, free list still works', async () => {
    await setSettings({ paidOnlyMode: true, subscriptionEnabled: true })
    for (const c of ['joke', 'balance', 'lock']) { const r = await authz(inst, c); assert.strictEqual(r.allow, false, c); assert.strictEqual(r.code, 'NOT_PREMIUM', c); assert.ok(/Premium is required/.test(r.message)) }
    for (const c of ['subscribe', 'premium', 'menu', 'ping']) assert.strictEqual((await authz(inst, c)).allow, true, c)
    await setSettings({ paidOnlyMode: false })
  })
  await t('free list always keeps subscribe + premium', async () => { await setSettings({ paidOnlyFreeCommands: 'menu' }); const l = (await A('GET', '/settings')).body.settings.paidOnlyFreeCommands; assert.ok(l.includes('subscribe') && l.includes('premium') && l.includes('menu')) })
  await t('Paystack not configured: status says payments unavailable, checkout refused', async () => {
    const s = (await R('POST', '/premium/status', { installId: inst.installId, token: inst.token })).body; assert.strictEqual(s.payments, false)
    const r = (await R('POST', '/premium/checkout', { installId: inst.installId, token: inst.token, plan: 'monthly', email: 'a@b.co' })).body; assert.strictEqual(r.ok, false); assert.strictEqual(r.error, 'PAYMENTS_UNAVAILABLE')
  })
  await t('Paystack cannot be enabled before a secret key exists', async () => assert.strictEqual((await A('PUT', '/paystack', { enabled: true })).status, 400))
  await t('Bot-facing authorize rejects an unknown token', async () => assert.strictEqual((await R('POST', '/premium/authorize', { installId: inst.installId, token: 'wrong', command: 'gideonai' })).status, 401))

  // ---------------------------------------------------------------- manual Premium ID (works without Paystack)
  let manualId
  await t('admin can issue a Premium ID without Paystack (format GID-nnnnnn)', async () => { const r = (await A('POST', '/premium/grant', { days: 30, ownerNumber: '2348000000001' })).body; assert.match(r.id, /^GID-\d{6}$/); manualId = r.id })
  await t('invalid Premium ID is rejected', async () => { const r = await R('POST', '/premium/claim', { installId: inst.installId, token: inst.token, premiumId: 'GID-000000' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error, 'INVALID_ID') })
  await t('malformed Premium ID is rejected', async () => assert.strictEqual((await R('POST', '/premium/claim', { installId: inst.installId, token: inst.token, premiumId: 'hello' })).body.error, 'INVALID_ID'))
  await t('valid Premium ID binds to the installation and unlocks premium commands', async () => {
    const r = (await R('POST', '/premium/claim', { installId: inst.installId, token: inst.token, premiumId: manualId })).body; assert.strictEqual(r.active, true)
    assert.strictEqual((await authz(inst, 'gideonai')).allow, true)
  })
  await t('premium stays active across a "restart" (a brand-new session for the same installation)', async () => { assert.strictEqual((await authz(inst, 'imagine')).allow, true) })
  await t('another installation cannot steal a bound ID', async () => { const other = await reg('2349000000009'); const r = await R('POST', '/premium/claim', { installId: other.installId, token: other.token, premiumId: manualId }); assert.strictEqual(r.body.error, 'BOUND_TO_ANOTHER'); assert.strictEqual((await authz(other, 'gideonai')).allow, false) })
  await t('same owner number can re-bind after losing its database (limited to 3 times)', async () => {
    let last
    for (let i = 0; i < 4; i++) { const again = await reg('2348000000001'); last = await R('POST', '/premium/claim', { installId: again.installId, token: again.token, premiumId: manualId }); if (i < 3) assert.strictEqual(last.body.active, true, 'rebind ' + i) }
    assert.strictEqual(last.body.error, 'BOUND_TO_ANOTHER')
  })
  await t('claim attempts are rate limited per installation', async () => { const x = await reg('2347000000007'); let r; for (let i = 0; i < 10; i++) r = await R('POST', '/premium/claim', { installId: x.installId, token: x.token, premiumId: 'GID-111111' }); assert.strictEqual(r.status, 429) })
  await t('expired Premium ID: blocked with EXPIRED', async () => {
    const e = await reg('2346000000006'); const id = (await A('POST', '/premium/grant', { days: 1 })).body.id
    await R('POST', '/premium/claim', { installId: e.installId, token: e.token, premiumId: id }); assert.strictEqual((await authz(e, 'gideonai')).allow, true)
    await db.collection('premiumIds').doc(id).update({ expiresAt: Date.now() - 1000 })
    const r = await authz(e, 'gideonai'); assert.strictEqual(r.allow, false); assert.strictEqual(r.code, 'EXPIRED')
    assert.strictEqual((await authz(e, 'lock')).allow, true) // free commands unaffected by expiry
  })
  await t('revoked Premium ID loses access; restore brings it back', async () => {
    const e = await reg('2345000000005'); const id = (await A('POST', '/premium/grant', { days: 5 })).body.id
    await R('POST', '/premium/claim', { installId: e.installId, token: e.token, premiumId: id })
    await A('POST', `/premium/${id}/revoke`); assert.strictEqual((await authz(e, 'gideonai')).allow, false)
    await A('POST', `/premium/${id}/restore`); assert.strictEqual((await authz(e, 'gideonai')).allow, true)
  })
  await t('global Premium Commands switch OFF blocks even subscribers', async () => { await setSettings({ premiumCommandsEnabled: false }); const r = await authz(inst, 'gideonai'); assert.strictEqual(r.allow, false); assert.strictEqual(r.code, 'PREMIUM_OFF'); assert.strictEqual((await authz(inst, 'lock')).allow, true); await setSettings({ premiumCommandsEnabled: true }) })
  await t('turning subscriptions OFF opens premium to everyone (Free Mode)', async () => { await setSettings({ subscriptionEnabled: false }); const r = await authz(inst, 'gideonai'); assert.strictEqual(r.allow, true); assert.strictEqual(r.tier, 'FREE_MODE'); await setSettings({ subscriptionEnabled: true }) })

  // ---------------------------------------------------------------- Paystack configured
  await t('Paystack secret is rejected if malformed', async () => assert.strictEqual((await A('PUT', '/paystack', { secretKey: 'hello' })).status, 400))
  await t('Paystack: environment/key mismatch is rejected', async () => assert.strictEqual((await A('PUT', '/paystack', { publicKey: 'pk_test_abc', secretKey: SK, environment: 'live' })).status, 400))
  await t('Paystack: save keys (encrypted at rest, never returned)', async () => {
    const r = await A('PUT', '/paystack', { publicKey: 'pk_test_abc123', secretKey: SK, environment: 'test' }); assert.strictEqual(r.status, 200)
    const g = (await A('GET', '/paystack')).body; assert.strictEqual(g.secretSet, true); assert.strictEqual(g.secretLast4, '3456'); assert.ok(!JSON.stringify(g).includes(SK))
    const stored = JSON.stringify(db.data.secrets.paystack); assert.ok(!stored.includes(SK), 'secret must not be stored in plaintext')
  })
  await t('Paystack: test connection succeeds with a good key', async () => assert.strictEqual((await A('POST', '/paystack/test')).body.ok, true))
  await t('Paystack: enable', async () => assert.strictEqual((await A('PUT', '/paystack', { enabled: true })).status, 200))
  await t('plans with price 0 are not purchasable', async () => { const r = (await R('POST', '/premium/checkout', { installId: inst.installId, token: inst.token, plan: 'monthly', email: 'a@b.co' })).body; assert.strictEqual(r.error, 'PLAN_UNAVAILABLE') })
  await setSettings({ plans: [{ id: 'monthly', name: 'Gideon Premium (30 days)', days: 30, amountNaira: 2500 }] })
  let buyer, ref
  await t('checkout needs a valid email', async () => { buyer = await reg('2348111111111'); assert.strictEqual((await R('POST', '/premium/checkout', { installId: buyer.installId, token: buyer.token, plan: 'monthly', email: 'nope' })).body.error, 'EMAIL_REQUIRED') })
  await t('checkout creates a pending payment with the amount decided by the SERVER (client amount ignored)', async () => {
    const r = (await R('POST', '/premium/checkout', { installId: buyer.installId, token: buyer.token, plan: 'monthly', email: 'buyer@example.com', amount: 1 })).body
    assert.strictEqual(r.ok, true); ref = r.reference; assert.strictEqual(paystack.last.amount, 250000); assert.match(r.url, /^https:\/\/checkout\.paystack\.com\//)
    assert.strictEqual(db.data.payments[ref].status, 'pending')
  })
  const hook = (body, key = SK) => { const raw = JSON.stringify(body); return R2('POST', '/paystack/webhook', raw, { 'x-paystack-signature': crypto.createHmac('sha512', key).update(raw).digest('hex') }) }
  const R2 = (m, u, raw, headers) => app.request(m, u, { body: JSON.parse(raw), raw, headers })
  await t('webhook with a bad signature is rejected and grants nothing', async () => { const r = await R2('POST', '/paystack/webhook', JSON.stringify({ event: 'charge.success', data: { reference: ref } }), { 'x-paystack-signature': 'deadbeef' }); assert.strictEqual(r.status, 401); assert.strictEqual(db.data.payments[ref].processed, false) })
  await t('signed webhook for a payment Paystack has NOT confirmed grants nothing (server verifies itself)', async () => { const r = await hook({ event: 'charge.success', data: { reference: ref } }); assert.strictEqual(r.status, 409, 'non-2xx so Paystack redelivers'); assert.strictEqual(db.data.payments[ref].processed, false); assert.strictEqual((await authz(buyer, 'gideonai')).allow, false) })
  let grantedId, expiry1
  await t('signed webhook after Paystack confirms: Premium ID generated, bound to the installation, expiry saved', async () => {
    paystack.paid[ref].settled = true
    // a new event id so the earlier unconfirmed attempt does not dedupe this one
    const r = await hook({ event: 'charge.success', data: { reference: ref, id: 7 } }); assert.strictEqual(r.status, 200)
    const p = db.data.payments[ref]; assert.strictEqual(p.processed, true); assert.match(p.premiumId, /^GID-\d{6}$/); grantedId = p.premiumId
    const pid = db.data.premiumIds[grantedId]; assert.strictEqual(pid.boundInstallId, buyer.installId); assert.strictEqual(pid.ownerNumber, '2348111111111'); assert.ok(pid.expiresAt > Date.now() + 29 * 86400000); expiry1 = pid.expiresAt
    assert.strictEqual((await authz(buyer, 'gideonai')).allow, true)
  })
  await t('DUPLICATE webhook does not grant twice or extend again', async () => {
    const before = Object.keys(db.data.premiumIds).length
    for (let i = 0; i < 3; i++) await hook({ event: 'charge.success', data: { reference: ref, id: 7 } })
    await hook({ event: 'charge.success', data: { reference: ref, id: 8 } }) // same payment, different event id
    assert.strictEqual(Object.keys(db.data.premiumIds).length, before); assert.strictEqual(db.data.premiumIds[grantedId].expiresAt, expiry1)
  })
  await t('concurrent webhook + customer poll settle exactly once', async () => {
    const b2 = await reg('2348222222222'); const c = (await R('POST', '/premium/checkout', { installId: b2.installId, token: b2.token, plan: 'monthly', email: 'x@y.co' })).body
    paystack.paid[c.reference].settled = true
    const before = Object.keys(db.data.premiumIds).length
    await Promise.all([hook({ event: 'charge.success', data: { reference: c.reference, id: 21 } }), R('POST', '/premium/payment', { installId: b2.installId, token: b2.token, reference: c.reference }), R('POST', '/premium/payment', { installId: b2.installId, token: b2.token, reference: c.reference })])
    assert.strictEqual(Object.keys(db.data.premiumIds).length, before + 1)
    assert.strictEqual((await authz(b2, 'gideonai')).allow, true)
  })
  await t('renewal by the same installation extends the SAME ID instead of issuing a new one', async () => {
    const c = (await R('POST', '/premium/checkout', { installId: buyer.installId, token: buyer.token, plan: 'monthly', email: 'buyer@example.com' })).body
    paystack.paid[c.reference].settled = true
    const before = Object.keys(db.data.premiumIds).length
    const p = (await R('POST', '/premium/payment', { installId: buyer.installId, token: buyer.token, reference: c.reference })).body
    assert.strictEqual(p.premiumId, grantedId); assert.strictEqual(Object.keys(db.data.premiumIds).length, before)
    assert.ok(db.data.premiumIds[grantedId].expiresAt >= expiry1 + 29 * 86400000)
  })
  await t('amount mismatch from Paystack grants nothing', async () => {
    const b3 = await reg('2348333333333'); const c = (await R('POST', '/premium/checkout', { installId: b3.installId, token: b3.token, plan: 'monthly', email: 'm@m.co' })).body
    paystack.paid[c.reference].settled = true; paystack.amountOverride = 100
    await hook({ event: 'charge.success', data: { reference: c.reference, id: 31 } }); paystack.amountOverride = null
    assert.strictEqual(db.data.payments[c.reference].status, 'amount_mismatch'); assert.strictEqual((await authz(b3, 'gideonai')).allow, false)
  })
  await t("one installation cannot read another's payment", async () => { const o = await reg('2348444444444'); assert.strictEqual((await R('POST', '/premium/payment', { installId: o.installId, token: o.token, reference: ref })).status, 404) })
  await t('Paystack switch OFF: checkout unavailable but existing subscribers keep working', async () => {
    await A('PUT', '/paystack', { enabled: false })
    const r = (await R('POST', '/premium/checkout', { installId: buyer.installId, token: buyer.token, plan: 'monthly', email: 'buyer@example.com' })).body; assert.strictEqual(r.error, 'PAYMENTS_UNAVAILABLE')
    assert.strictEqual((await authz(buyer, 'gideonai')).allow, true); await A('PUT', '/paystack', { enabled: true })
  })

  // ---------------------------------------------------------------- command category changes
  await t('Command Manager: FREE -> PREMIUM change takes effect', async () => { assert.strictEqual((await authz(await reg('2348555555555'), 'lock')).allow, true); await A('PUT', '/commands/lock', { tier: 'PREMIUM' }); const x = await reg('2348555555556'); assert.strictEqual((await authz(x, 'lock')).allow, false); await A('PUT', '/commands/lock', { tier: 'FREE' }); assert.strictEqual((await authz(x, 'lock')).allow, true) })
  await t('Command Manager: PREMIUM -> FREE makes an advanced command work without a subscription', async () => { const x = await reg('2348555555557'); assert.strictEqual((await authz(x, 'imagine')).allow, false); await A('PUT', '/commands/imagine', { tier: 'FREE' }); assert.strictEqual((await authz(x, 'imagine')).allow, true); await A('PUT', '/commands/imagine', { tier: 'PREMIUM' }) })
  await t('Command Manager: disabling a command blocks it everywhere; aliases follow', async () => { const x = await reg('2348555555558'); await A('PUT', '/commands/joke', { enabled: false }); assert.strictEqual((await authz(x, 'jokes')).code, 'DISABLED'); await A('PUT', '/commands/joke', { enabled: true }); assert.strictEqual((await authz(x, 'joke')).allow, true) })
  await t('Command Manager: bad tier / unknown command rejected', async () => { assert.strictEqual((await A('PUT', '/commands/lock', { tier: 'GOLD' })).status, 400); assert.strictEqual((await A('PUT', '/commands/doesnotexist', { tier: 'FREE' })).status, 400) })
  await t('Command Manager lists every command with class, tier, policy and handler status', async () => { const l = (await A('GET', '/commands')).body.commands; assert.ok(l.length > 250); assert.ok(l.every((c) => c.class && c.tier && c.handler)); assert.strictEqual(l.find((c) => c.name === 'vv2').policy, 'restricted') })
  await t('every economy and fun command is FREE by default', async () => { const l = (await A('GET', '/commands')).body.commands; assert.deepStrictEqual(l.filter((c) => ['economy', 'fun'].includes(c.class) && c.tier !== 'FREE').map((c) => c.name), []) })
  await t('user-named FREE examples are FREE and PREMIUM examples are PREMIUM by default', async () => {
    const l = Object.fromEntries((await A('GET', '/commands')).body.commands.map((c) => [c.name, c.tier]))
    for (const n of ['lock', 'unlock', 'block', 'unblock', 'kick', 'add', 'promote', 'demote', 'groupinfo', 'tagall', 'hidetag', 'setname', 'setdesc', 'antilink', 'welcome', 'goodbye', 'balance', 'daily', 'weekly', 'work', 'rob', 'gamble', 'deposit', 'withdraw', 'transfer', 'shop', 'buy', 'sell', 'inventory', 'leaderboard', 'joke', 'meme', 'fact', 'trivia', 'dice', '8ball', 'ship', 'rate']) assert.strictEqual(l[n], 'FREE', n)
    for (const n of ['anticall', 'savestatus', 'autostatus', 'statusreact', 'gideonai', 'imagine', 'hd', 'removebg', 'autoreply']) assert.strictEqual(l[n], 'PREMIUM', n)
    for (const n of ['vv', 'vv2', 'antidelete']) assert.strictEqual(l[n], 'RESTRICTED', n)
  })

  // ---------------------------------------------------------------- economy independence + integrity
  await t('economy mode LOCAL/GLOBAL is switchable and exposed to bots', async () => { await setSettings({ economyMode: 'GLOBAL' }); assert.strictEqual((await R('GET', '/policy')).body.settings.economyMode, 'GLOBAL'); await setSettings({ economyMode: 'LOCAL' }); assert.strictEqual((await R('GET', '/policy')).body.settings.economyMode, 'LOCAL'); assert.strictEqual((await A('PUT', '/settings', { economyMode: 'BOTH' })).status, 400) })
  await t('economy keeps working with subscriptions OFF and Paystack OFF', async () => { await setSettings({ subscriptionEnabled: false, paystackEnabled: false }); assert.strictEqual((await R('POST', '/work', { number: '1' })).body.ok, true); assert.strictEqual((await authz(inst, 'work')).allow, true) })
  await t('economy keeps working with subscriptions ON', async () => { await setSettings({ subscriptionEnabled: true }); assert.strictEqual((await R('POST', '/work', { number: '1' })).body.ok, true) })
  await t('Economy System switch only affects the economy (fun + premium unaffected)', async () => {
    await setSettings({ economyEnabled: false }); assert.strictEqual((await R('POST', '/work', { number: '1' })).status, 503); assert.strictEqual((await authz(inst, 'balance')).code, 'ECONOMY_OFF'); assert.strictEqual((await authz(inst, 'joke')).allow, true); assert.strictEqual((await authz(inst, 'lock')).allow, true)
    await setSettings({ economyEnabled: true }); assert.strictEqual((await R('POST', '/work', { number: '1' })).body.ok, true)
  })
  await t('Fun switch only affects fun commands', async () => { await setSettings({ funEnabled: false }); assert.strictEqual((await authz(inst, 'joke')).code, 'FUN_OFF'); assert.strictEqual((await authz(inst, 'balance')).allow, true); await setSettings({ funEnabled: true }) })
  await t('duplicate economy request (same idempotency key) is applied once and replayed', async () => {
    workCalls = 0; const h = { 'x-idempotency-key': 'abcdef1234567890' }
    const a = await R('POST', '/work', { number: '5' }, h), b = await R('POST', '/work', { number: '5' }, h), c = await R('POST', '/work', { number: '5' }, h)
    assert.strictEqual(workCalls, 1); assert.deepStrictEqual(b.body, a.body); assert.deepStrictEqual(c.body, a.body)
  })
  await t('different idempotency keys are separate transactions', async () => { workCalls = 0; await R('POST', '/work', { number: '5' }, { 'x-idempotency-key': 'key-number-one' }); await R('POST', '/work', { number: '5' }, { 'x-idempotency-key': 'key-number-two' }); assert.strictEqual(workCalls, 2) })
  await t('economy requests are written to the transaction log', async () => { await new Promise((r) => setTimeout(r, 20)); const tx = (await A('GET', '/economy/transactions?number=5')).body.transactions; assert.ok(tx.length >= 3 && tx.every((x) => x.number === '5')) })
  await db.collection('players').doc('111').set({ balance: 1000, banked: 0 })
  await t('admin balance adjustment is audited and cannot create a negative balance', async () => {
    assert.strictEqual((await A('POST', '/economy/players/111/adjust', { delta: -5000, reason: 'test' })).status, 400); assert.strictEqual(db.data.players['111'].balance, 1000)
    assert.strictEqual((await A('POST', '/economy/players/111/adjust', { delta: 250, reason: 'event reward' })).body.after, 1250)
    assert.strictEqual((await A('POST', '/economy/players/111/adjust', { delta: 5, reason: '' })).body.after, 1255, 'blank reason gets a default')
    const set1 = (await A('POST', '/economy/players/111/adjust', { mode: 'set', amount: '5000' })).body; assert.strictEqual(set1.after, 5000); assert.strictEqual(db.data.players['111'].balance, 5000)
    assert.strictEqual((await A('POST', '/economy/players/111/adjust', { mode: 'set', amount: 0 })).body.after, 0)
    assert.strictEqual((await A('POST', '/economy/players/111/adjust', { mode: 'set', amount: -5 })).status, 400)
    await A('POST', '/economy/players/111/adjust', { mode: 'set', amount: 1250 })
    const logs = (await A('GET', '/logs')).body.logs; assert.ok(logs.some((l) => l.action === 'economy.adjust' && l.detail.number === '111'))
  })
  await t('concurrent adjustments never overdraw', async () => { await db.collection('players').doc('222').set({ balance: 100 }); const rs = await Promise.all(Array.from({ length: 5 }, () => A('POST', '/economy/players/222/adjust', { delta: -40, reason: 'race' }))); assert.strictEqual(rs.filter((r) => r.status === 200).length, 2); assert.strictEqual(db.data.players['222'].balance, 20) })
  await t('economy config validated and applied live (daily reward, bets, shop price)', async () => {
    assert.strictEqual((await A('PUT', '/economy/config', { workMin: 900, workMax: 100 })).status, 400)
    assert.strictEqual((await A('PUT', '/economy/config', { dailyReward: -5 })).status, 400)
    assert.strictEqual((await A('PUT', '/economy/config', { dailyReward: 750, currencyName: 'gold', itemPrices: { shield: 1200 } })).status, 200)
    assert.strictEqual(core.econ.dailyReward, 750); assert.strictEqual((await R('GET', '/policy')).body.settings.currencyName, 'gold')
  })
  await t('economy players search + stats endpoints work', async () => { assert.strictEqual((await A('GET', '/economy/players?search=111')).body.players[0].balance, 1250); assert.ok((await A('GET', '/economy/stats')).body.global.players >= 2) })

  // ---------------------------------------------------------------- file manager security
  const up = (kind, name, content) => A('POST', '/files', { kind, name, contentBase64: Buffer.from(content).toString('base64') })
  const good = "module.exports = { name: 'hello', desc: 'hi', async run(sock, m) { await m.reply('hi') } }"
  await t('file upload: path traversal / bad names rejected', async () => { for (const n of ['../evil.js', 'a/b.js', '.hidden.js', 'x'.repeat(80) + '.js']) assert.strictEqual((await up('plugin', n, good)).status, 422, n) })
  await t('file upload: plugin using child_process / eval / process.env / fs write rejected', async () => {
    for (const src of ["const c=require('child_process');module.exports={name:'x',run(){}}", "module.exports={name:'x',run(){eval('1')}}", "module.exports={name:'x',run(){return process.env.SECRET}}", "const fs=require('fs');fs.writeFileSync('a','b');module.exports={name:'x',run(){}}", "module.exports={name:'x',run(){require(someVar)}}", "module.exports={name:'x',run(){ return require('fs').readFileSync('session/creds.json') }}"]) assert.strictEqual((await up('plugin', 'bad.js', src)).status, 422, src)
  })
  await t('file upload: plugin missing the command interface or with a syntax error rejected', async () => { assert.strictEqual((await up('plugin', 'a.js', 'const x = 1')).status, 422); assert.strictEqual((await up('plugin', 'b.js', 'module.exports = { name: "x", run( {')).status, 422) })
  await t('file upload: wrong extension for kind, empty, oversize rejected', async () => { assert.strictEqual((await up('plugin', 'a.exe', good)).status, 422); assert.strictEqual((await up('config', 'a.js', good)).status, 422); assert.strictEqual((await A('POST', '/files', { kind: 'config', name: 'e.json', contentBase64: '' })).status, 422); assert.strictEqual((await up('asset', 'big.txt', 'x'.repeat(300 * 1024))).status, 400); assert.strictEqual((await up('asset', 'mid.txt', 'x'.repeat(260 * 1024))).status, 422) })
  await t('file upload: config must be valid JSON; image must match its magic bytes; svg scripts rejected', async () => { assert.strictEqual((await up('config', 'c.json', '{bad')).status, 422); assert.strictEqual((await up('config', 'c.json', '{"a":1}')).status, 200); assert.strictEqual((await up('image', 'i.png', 'not a png')).status, 422); assert.strictEqual((await A('POST', '/files', { kind: 'image', name: 'i.png', contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64') })).status, 200); assert.strictEqual((await up('asset', 's.svg', '<svg><script>alert(1)</script></svg>')).status, 422) })
  await t('file upload: a valid plugin is stored as VALIDATED (inactive) and is never executed by the server', async () => {
    global.__PWNED = undefined
    const evil = "global.__PWNED = true; module.exports = { name: 'hello', desc: 'hi', async run() {} }"
    assert.strictEqual((await up('plugin', 'hello.js', evil)).status, 200)
    assert.strictEqual(global.__PWNED, undefined, 'uploaded code must not run at upload')
    assert.strictEqual(db.data.files['hello.js'].status, 'validated')
    assert.strictEqual((await A('POST', '/files/hello.js/approve')).status, 200); assert.strictEqual(global.__PWNED, undefined, 'uploaded code must not run at approval')
    assert.strictEqual(db.data.files['hello.js'].status, 'active')
  })
  await t('plugins are NOT distributed without a signing key', async () => assert.strictEqual((await R('GET', '/plugins')).body.distribution, 'disabled'))
  await t('plugin signing: bots receive a verifiable signature once a key is configured', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PLUGIN_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const r = (await R('GET', '/plugins')).body; const p = r.plugins[0]
    assert.strictEqual(r.distribution, 'signed'); assert.ok(crypto.verify(null, Buffer.from(`${p.name}:${p.version}:${p.sha256}`), publicKey, Buffer.from(p.signature, 'base64')))
    delete process.env.PLUGIN_SIGNING_KEY
  })
  await t('file versioning + rollback (rolled-back plugin needs re-approval)', async () => {
    await up('plugin', 'hello.js', "module.exports = { name: 'hello', desc: 'v2', async run() {} }"); assert.strictEqual(db.data.files['hello.js'].version, 2)
    assert.strictEqual((await A('POST', '/files/hello.js/rollback', { version: 1 })).status, 200); assert.strictEqual(db.data.files['hello.js'].version, 3); assert.strictEqual(db.data.files['hello.js'].status, 'validated')
    assert.strictEqual((await A('POST', '/files/hello.js/rollback', { version: 99 })).status, 400)
  })
  await t('file manager writes upload logs, including rejected uploads', async () => { const l = (await A('GET', '/uploadlogs')).body.logs; assert.ok(l.some((x) => x.status === 'rejected') && l.some((x) => x.status !== 'rejected')) })
  await t('file validator unit checks', async () => { assert.deepStrictEqual(filesMod.validate('plugin', 'ok.js', Buffer.from(good)), []); assert.ok(filesMod.validate('plugin', 'ok.js', Buffer.from('require("child_process")')).length) })

  // ---------------------------------------------------------------- dashboard data endpoints
  await t('dashboard endpoints respond (overview, installs, payments, premium, analytics, logs, security)', async () => { for (const u of ['/overview', '/installs', '/premium', '/payments', '/analytics', '/logs', '/security', '/economy/config', '/files']) { const r = await A('GET', u); assert.strictEqual(r.status, 200, u) } })
  await t('payments list masks customer emails and never includes keys', async () => { const j = JSON.stringify((await A('GET', '/payments')).body); assert.ok(!j.includes('buyer@example.com')); assert.ok(!j.includes(SK)) })
  await t('bots only get the public settings subset (no keys, no plans)', async () => { const s = (await R('GET', '/policy')).body.settings; assert.ok(!('plans' in s)); assert.ok(!JSON.stringify(s).includes('sk_')) })
  await t('security page flags the NETWORK_KEY published in the repo', async () => { process.env.NETWORK_KEY = '56c606233b6cd99e1a5aac838df40f5a'; const c = (await A('GET', '/security')).body.checks.find((x) => /NETWORK_KEY/.test(x.label)); assert.strictEqual(c.ok, false) })

  for (const r of results) console.log(r[0] === 'PASS' ? '  ok  ' : ' FAIL ', r[1], r[2] ? '\n        -> ' + r[2] : '')
  console.log(`\nplatform tests: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
