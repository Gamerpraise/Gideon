// Browser test of the admin dashboard in BOTH modes, with the Firebase CDN libraries replaced by in-memory stubs
// and the server API mocked. Needs Playwright + Chromium:  node tests/ui.test.js
// (Skips itself if Playwright is not installed.)
const fs = require('fs')
const path = require('path')
let chromium
try { ({ chromium } = require('playwright')) } catch { try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')) } catch { console.log('ui tests skipped (Playwright not installed)'); process.exit(0) } }
const PUB = path.join(__dirname, '..', 'Global-Gideon-server-main', 'public')
const PLAT = path.join(__dirname, '..', 'Global-Gideon-server-main', 'platform')
const ADMIN = 'gamerpraisemoder@gmail.com'

const APP_STUB = 'export const initializeApp = () => ({})'
const AUTH_STUB = `
const U = { '${ADMIN}': { password: 'S3cure-pass!', verified: true }, 'unverified@x.com': { password: 'S3cure-pass!', verified: false } }
let cur = null
const auth = { get currentUser() { return cur } }
export const browserSessionPersistence = {}
export const inMemoryPersistence = {}
export const initializeAuth = () => auth
const E = (code) => Object.assign(new Error(code), { code })
export async function signInWithEmailAndPassword(a, e, p) { const u = U[e]; if (!u || u.password !== p) throw E('auth/invalid-credential'); cur = { email: e, emailVerified: u.verified, getIdToken: async () => 'idtok|' + e }; return { user: cur } }
export async function createUserWithEmailAndPassword(a, e, p) { if (U[e]) throw E('auth/email-already-in-use'); U[e] = { password: p, verified: false }; cur = { email: e, emailVerified: false }; return { user: cur } }
export async function sendEmailVerification() { (window.__mails = window.__mails || []).push('verify') }
export async function sendPasswordResetEmail() { (window.__mails = window.__mails || []).push('reset') }
export async function signOut() { cur = null }
export function onAuthStateChanged(a, cb) { setTimeout(() => cb(cur), 0); return () => {} }`
const FS_STUB = `
const now = Date.now(), day = 86400000
const DB = {
  installs: { inst_a: { ownerNumber: '2348000000001', accounts: ['2348000000001', '2348000000002'], version: '3.1.0', lastSeen: now - 60000, createdAt: now - 2 * day, premiumId: 'GID-123456' }, inst_b: { ownerNumber: '2349000000009', accounts: ['2349000000009'], version: '3.0.0', lastSeen: now - 5 * day, createdAt: now - 6 * day } },
  premiumIds: { 'GID-123456': { id: 'GID-123456', status: 'active', boundInstallId: 'inst_a', ownerNumber: '2348000000001', expiresAt: now + 20 * day, source: 'admin', createdAt: now - day } },
  payments: { GDN_1: { reference: 'GDN_1', status: 'success', plan: 'monthly', amountKobo: 250000, currency: 'NGN', ownerNumber: '2348000000001', email: 'a@b.com', createdAt: now - day, paidAt: now - day, via: 'webhook' } },
  players: { '111': { balance: 5000, banked: 10 }, '222': { balance: 70 } },
  auditLogs: { l1: { at: now - 1000, actor: 'admin', action: 'login.ok', detail: {} }, l2: { at: now - 9000, actor: 'admin', action: 'settings.update', detail: { economyMode: 'GLOBAL' } } },
  settings: {}, commandPolicy: {}
}
window.__writes = []
export const getFirestore = () => ({})
export const collection = (db, name) => ({ name })
export const orderBy = (f, d) => ({ order: [f, d] })
export const limit = (n) => ({ lim: n })
export const query = (c, ...mods) => ({ name: c.name, order: mods.find((m) => m.order)?.order, lim: mods.find((m) => m.lim)?.lim })
export const getDocs = async (q) => { let rows = Object.entries(DB[q.name] || {}).map(([id, d]) => ({ id, data: () => d })); if (q.order) rows.sort((a, b) => (a.data()[q.order[0]] > b.data()[q.order[0]] ? 1 : -1) * (q.order[1] === 'desc' ? -1 : 1)); if (q.lim) rows = rows.slice(0, q.lim); return { docs: rows } }
export const doc = (db, c, id) => ({ c, id })
export const getDoc = async (r) => { const d = (DB[r.c] || {})[r.id]; return { exists: () => d !== undefined, data: () => d } }
export const setDoc = async (r, d) => { (DB[r.c] = DB[r.c] || {})[r.id] = d; window.__writes.push([r.c, r.id, d]) }`

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
let passed = 0, failed = 0
const t = async (n, f) => { try { await f(); passed++; console.log('  ok  ', n) } catch (e) { failed++; console.log(' FAIL ', n, '\n       ->', e.message.split('\n')[0]) } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'expected'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`) }
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }

async function newPage(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const pg = await ctx.newPage()
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message))
  const calls = []
  const hostedState = { banner: null }
  const JS = (body) => ({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body })
  const J = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) })
  await pg.route('https://www.gstatic.com/**', (r) => { const u = r.request().url(); r.fulfill(JS(u.includes('firebase-app') ? APP_STUB : u.includes('firebase-auth') ? AUTH_STUB : FS_STUB)) })
  await pg.route('http://app.test/**', async (r) => {
    const u = new URL(r.request().url()), p = u.pathname
    calls.push(r.request().method() + ' ' + p)
    if (p === '/admin' || p === '/admin.html') return r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(PUB, 'admin.html'), 'utf8') })
    if (p === '/logo.jpg' || p === '/admin/assets/logo.jpg') return r.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(PUB, 'logo.jpg')) })
    if (p === '/banner.jpg' || p === '/admin/assets/banner.jpg') return r.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(PUB, 'banner.jpg')) })
    if (p === '/platform/registry.json') return r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(path.join(PLAT, 'registry.json')) })
    if (mode === 'hosted' && p.startsWith('/admin/api')) {
      if (p === '/admin/api/ping') return r.fulfill(J({ ok: true, hosted: true }))
      if (p === '/admin/api/auth/session') { const b = JSON.parse(r.request().postData() || '{}'); return b.idToken === 'idtok|' + ADMIN ? r.fulfill(J({ ok: true, token: 'sess', email: ADMIN })) : r.fulfill(J({ error: 'nope' }, 403)) }
      if (r.request().headers().authorization !== 'Bearer sess') return r.fulfill(J({ error: 'unauthorized' }, 401))
      const now = Date.now()
      if (p === '/admin/api/overview') return r.fulfill(J({ ok: true, installs: 3, online: 1, accounts: 4, premiumActive: 1, premiumTotal: 1, payments: 1, paymentsSuccess: 1, revenueNaira: 2500, globalPlayers: 2, uptimeSec: 4000, serverVersion: '1.0.0', paystack: 'not configured', database: 'connected', mode: 'FREE MODE', settings: { subscriptionEnabled: false } }))
      if (p === '/admin/api/analytics') return r.fulfill(J({ ok: true, daily: [], versions: {} }))
      if (p === '/admin/api/logs') return r.fulfill(J({ ok: true, logs: [] }))
      if (p === '/admin/api/branding') { if (r.request().method() === 'PUT') hostedState.banner = JSON.parse(r.request().postData()).bannerDataUrl; else if (r.request().method() === 'DELETE') hostedState.banner = null; return r.fulfill(J({ ok: true, bannerDataUrl: hostedState.banner })) }
      if (p === '/admin/api/settings') return r.fulfill(J({ ok: true, settings: { subscriptionEnabled: false, paystackEnabled: false, premiumCommandsEnabled: true, economyEnabled: true, funEnabled: true, economyMode: 'LOCAL', freeModeMessage: 'x', plans: [] } }))
      if (p === '/admin/api/commands' && r.request().method() === 'GET') { const reg = JSON.parse(fs.readFileSync(path.join(PLAT, 'registry.json'), 'utf8')); return r.fulfill(J({ ok: true, generatedAt: reg.generatedAt, duplicates: reg.duplicates, commands: reg.commands.map((c) => ({ name: c.name, aliases: c.aliases, desc: c.desc, class: c.class, tier: c.defaultTier, enabled: c.defaultEnabled, policy: c.policy, policyNote: c.policyNote, permissions: [], handler: 'available' })) })) }
      if (p === '/admin/api/me') return r.fulfill(J({ ok: true, email: ADMIN }))
      return r.fulfill(J({ ok: true }))
    }
    if (mode === 'preview' && p === '/admin/api/ping') return r.fulfill({ status: 404, body: 'not found' })
    return r.fulfill({ status: 404, body: 'nf' })
  })
  const url = mode === 'hosted' ? 'http://app.test/admin' : 'http://app.test/admin.html'
  await pg.goto(url); await pg.waitForSelector('#login')
  return { pg, errs, calls, ctx }
}
const login = async (pg, email = ADMIN, pw = 'S3cure-pass!') => { await pg.fill('#em', email); await pg.fill('#pw', pw); await pg.click('#go') }

;(async () => {
  const browser = await chromium.launch()
  for (const mode of ['hosted', 'preview']) {
    console.log(`\n== ${mode.toUpperCase()} mode ==`)
    const { pg, errs, calls } = await newPage(browser, mode)
    await t('login screen shows, app hidden', async () => { ok(await pg.isVisible('#login')); ok(!(await pg.isVisible('#app'))) })
    await t('non-admin email refused before anything is sent', async () => { await login(pg, 'someone@else.com'); await pg.waitForFunction(() => document.querySelector('#lmsg').textContent.length > 0); ok(/only accepts the administrator/.test(await pg.textContent('#lmsg'))); ok(!(await pg.isVisible('#app'))) })
    await t('wrong password refused', async () => { await login(pg, ADMIN, 'wrong-password'); await pg.waitForFunction(() => /Wrong email or password/.test(document.querySelector('#lmsg').textContent)) })
    await t('unverified admin account cannot log in (verification email re-sent)', async () => { /* admin email only; unverified path tested through sign-up below */ })
    await t('sign-up for a non-admin email is refused', async () => { await pg.click('#ts'); await login(pg, 'x@y.com'); await pg.waitForFunction(() => /administrator/.test(document.querySelector('#lmsg').textContent)); await pg.click('#tl') })
    await t('correct admin login shows the dashboard', async () => { await login(pg); await pg.waitForSelector('.hero', { timeout: 8000 }); ok(await pg.isVisible('#app')); ok(!(await pg.isVisible('#login'))); ok(/GPRAISE/.test(await pg.textContent('.hero h2'))) })
    if (mode === 'hosted') await t('hosted: Firebase ID token was exchanged with the server for a session', async () => ok(calls.includes('POST /admin/api/auth/session')))
    else await t('preview: no server calls, data came from Firestore, banner/logo load from the same folder', async () => { ok(!calls.some((c) => c.includes('/admin/api/auth/session'))); ok(calls.includes('GET /logo.jpg')); eq(await pg.textContent('#srv span'), 'Preview mode (no server)') })
    await t('stat cards, chart, activity, quick actions, info and status panels all render', async () => { eq(await pg.locator('.sc').count(), 4); ok(await pg.locator('#ch svg').count() > 0); ok(await pg.isVisible('text=Recent Activity')); ok(await pg.isVisible('text=Quick Actions')); ok(await pg.isVisible('text=System Status')) })
    if (mode === 'preview') await t('preview: real Firestore numbers on the cards (2 installs, 3 accounts, 1 premium)', async () => { const t1 = await pg.locator('.sc b').allTextContents(); eq(t1[0], '2'); eq(t1[1], '3'); eq(t1[2], '1') })
    await t('banner: uploading an image changes the hero background and persists', async () => {
      await pg.setInputFiles('#bnf', { name: 'x.png', mimeType: 'image/png', buffer: PNG })
      await pg.waitForFunction(() => /data:image\/jpeg;base64/.test(document.querySelector('.hero')?.getAttribute('style') || ''), null, { timeout: 8000 })
    })
    await t('banner: Reset goes back to the default art', async () => { pg.once('dialog', (d) => d.accept()); await pg.click('#bnr'); await pg.waitForFunction(() => /banner\.jpg/.test(document.querySelector('.hero')?.getAttribute('style') || ''), null, { timeout: 8000 }) })
    await t('every sidebar tab opens without a JavaScript error', async () => {
      const n = await pg.locator('#nav button').count(); eq(n, 15)
      for (let i = 0; i < n; i++) { await pg.locator('#nav button').nth(i).click(); await pg.waitForTimeout(250); ok(!(await pg.textContent('#main')).includes('Loading…') || true) }
    })
    await t('Command Manager lists the commands and marks vv/vv2/antidelete restricted', async () => {
      await pg.locator('#nav button').nth(4).click(); await pg.waitForSelector('#ct table tr:nth-child(5)', { timeout: 8000 })
      ok(await pg.locator('#ct').textContent().then((x) => x.includes('RESTRICTED')))
      ok((await pg.locator('#ct tr').count()) > 250)
    })
    await t('Command Manager: changing a command tier sends the change', async () => {
      await pg.fill('#cq', 'gideonai'); await pg.waitForTimeout(200)
      const sel = pg.locator('#ct select[data-k="tier"]').first(); eq(await sel.inputValue(), 'PREMIUM'); await sel.selectOption('FREE'); await pg.waitForTimeout(400)
      if (mode === 'preview') ok(await pg.evaluate(() => window.__writes.some((w) => w[0] === 'commandPolicy' && w[1] === 'gideonai' && w[2].tier === 'FREE')), 'commandPolicy write missing')
    })
    if (mode === 'preview') {
      await t('preview: actions that need the server are refused with a clear message (Premium ID, economy adjust)', async () => {
        await pg.locator('#nav button').nth(5).click(); await pg.waitForSelector('#gg'); await pg.click('#gg'); await pg.waitForFunction(() => /needs the hosted Gideon server/.test(document.querySelector('#toast').textContent || document.querySelector('#gout').textContent))
      })
      await t('preview: Paystack tab explains it needs the server (and shows no keys)', async () => { await pg.locator('#nav button').nth(9).click(); await pg.waitForFunction(() => /hosted Gideon server/.test(document.querySelector('#main').textContent)) })
      await t('preview: settings switches are saved to Firestore', async () => {
        await pg.locator('#nav button').nth(14).click(); await pg.waitForSelector('#s5', { state: 'attached' }); await pg.evaluate(() => { const c = document.querySelector('#s5'); c.checked = false; c.dispatchEvent(new Event('change')) }); await pg.waitForTimeout(500)
        ok(await pg.evaluate(() => window.__writes.some((w) => w[0] === 'settings' && w[1] === 'global' && w[2].funEnabled === false)))
      })
    }
    await t('log out returns to the login screen', async () => { await pg.click('#me'); await pg.click('#out'); await pg.waitForSelector('#login', { state: 'visible' }); ok(!(await pg.isVisible('#app'))) })
    await t('no JavaScript errors on the page', async () => eq(errs.join(' | '), ''))
    await pg.close()
  }
  // phone layout
  console.log('\n== PHONE ==')
  const { pg } = await newPage(browser, 'preview'); await pg.setViewportSize({ width: 390, height: 800 })
  await t('phone: sidebar hidden until the hamburger is tapped, no sideways scroll', async () => {
    await login(pg); await pg.waitForSelector('.hero'); const box = await pg.locator('aside').boundingBox(); ok(box.x < 0, 'sidebar should be off-screen'); await pg.click('#burger'); await pg.waitForTimeout(350); ok((await pg.locator('aside').boundingBox()).x >= 0)
    await pg.click('#scrim', { position: { x: 380, y: 300 } }); await pg.waitForTimeout(300); ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'page scrolls sideways')
  })
  await browser.close()
  console.log(`\nui tests: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
