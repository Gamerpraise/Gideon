// Runs the REAL inline script of cloud/index.html against a tiny DOM shim and the test-only mock backend.
// Run: node cloud/tests/ui.cloud.test.js   (Node 20+, no dependencies)
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert')
const { createCloud } = require('../cloud')
const os = require('os')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
const ids = [...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1])

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.ls = {}; this.value = ''; this._text = ''; this.disabled = false; this.style = {}; this.scrollTop = 0; this.scrollHeight = 0
    const set = new Set(); this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, f) => ((f === undefined ? !set.has(c) : f) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c), _s: set } }
  set className(v) { this.classList._s.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList._s.add(c)) }
  get className() { return [...this.classList._s].join(' ') }
  set textContent(v) { this.children = []; this._text = String(v) }
  get textContent() { return this._text + this.children.map((c) => (c.nodeType ? c.textContent : '')).join('') }
  get lastChild() { return this.children[this.children.length - 1] } get firstChild() { return this.children[0] }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') El.reg[v] = this } getAttribute(k) { return this.attrs[k] } hasAttribute(k) { return k in this.attrs }
  set href(v) { this.attrs.href = v } get href() { return this.attrs.href }
  append(...k) { for (const x of k) this.children.push(typeof x === 'string' ? Object.assign(new El('#text'), { _text: x }) : x) }
  replaceChildren(...k) { this.children = []; this._text = ''; this.append(...k.filter(Boolean)) }
  addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f) }
  fire(t, ev = {}) { return Promise.all((this.ls[t] || []).map((f) => f({ preventDefault() {}, target: this, ...ev }))) }
  querySelector(sel) { const out = this.all(); return out.find((e) => (sel[0] === '.' ? e.classList.contains(sel.slice(1)) : e.tag === sel)) || null }
  all() { return this.children.flatMap((c) => (c.tag === '#text' ? [] : [c, ...c.all()])) }
  get nodeType() { return 1 }
  find(pred) { return this.all().find(pred) }
  focus() {} scrollIntoView() {} showModal() { this.open = true } close() { this.open = false } setAttr() {}
}
El.reg = {}

El.reg = {}
// Fake Firebase Authentication (REST) so no network is needed: any password "pass123" works for known emails.
function fakeFirebase(users) {
  const mkTok = (email) => 'tok:' + email
  return async (url, o) => {
    const u = String(url); const j = (code, body) => ({ ok: code < 400, status: code, json: async () => body })
    const body = o.body && o.body.startsWith('{') ? JSON.parse(o.body) : Object.fromEntries(new URLSearchParams(o.body || ''))
    if (u.includes('signInWithPassword')) { const x = users[body.email]; return x && x.pw === body.password ? j(200, { idToken: jwt(body.email), refreshToken: 'rt:' + body.email, expiresIn: '3600' }) : j(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) }
    if (u.includes('accounts:signUp')) { if (users[body.email]) return j(400, { error: { message: 'EMAIL_EXISTS' } }); users[body.email] = { pw: body.password, verified: false }; return j(200, { idToken: jwt(body.email), refreshToken: 'rt:' + body.email, expiresIn: '3600' }) }
    if (u.includes('sendOobCode')) { fakeFirebase.sent.push(body.requestType); return j(200, {}) }
    if (u.includes('securetoken.googleapis.com')) { const email = String(body.refresh_token).slice(3); return j(200, { id_token: jwt(email), refresh_token: body.refresh_token, expires_in: '3600' }) }
    return null
  }
  function jwt(email) { return 'h.' + Buffer.from(JSON.stringify({ email })).toString('base64url') + '.s' }
}
fakeFirebase.sent = []
const fbUsers = { 'a@x.com': { pw: 'pass123', verified: true }, 'b@x.com': { pw: 'pass123', verified: true }, 'u@x.com': { pw: 'pass123', verified: false } }
const verify = async (t) => { const email = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).email; const u = fbUsers[email]; if (!u) throw new Error('no'); return { uid: 'uid-' + email, email, emailVerified: u.verified } }
function fakeManager() {
  const bots = new Map()
  return { get: (id) => bots.get(id), list: () => [...bots.values()], cloud: {
    async open(id) { const old = bots.get(id); if (old) await old.stop(); const c = { id, cloud: true, stopped: false, status: 'connecting', lastError: '', openedAt: 0, logs: ['[x] connected', '[x] ready'] }; c.stop = async () => { c.stopped = true; c.status = 'offline' }; bots.set(id, c); setTimeout(() => { if (!c.stopped && !c.never) { c.status = 'online'; c.openedAt = Date.now() - 125000 } }, 30); return c },
    async stop(id) { const c = bots.get(id); if (c) await c.stop(); return !!c }, async close(id) { bots.delete(id); return true } } }
}
async function backend(opts = {}) {
  const manager = fakeManager(); const dir = require('fs').mkdtempSync(path.join(os.tmpdir(), 'gcu-'))
  if (opts.never) { const o = manager.cloud.open; manager.cloud.open = async (...a) => { const c = await o(...a); c.never = true; return c } }
  const svc = createCloud({ manager, dataDir: dir, verify, log() {}, cfg: { maxBotsPerUser: 3, maxBots: 20, requireVerifiedEmail: true, allowedOrigins: [] } })
  await new Promise((r) => svc.server.listen(0, r)); return { port: svc.server.address().port, close: () => svc.server.close(), manager }
}
function setup(cfg, { token } = {}) {
  const els = {}; for (const id of ids) els[id] = new El('div')
  els.backend.append(new El('span'), Object.assign(new El('span'), { _text: '' }))
  const store = {}; if (token) store['gc.rt'] = token
  const doc = { getElementById: (id) => El.reg[id] || els[id], createElement: (t) => new El(t), createTextNode: (t) => Object.assign(new El('#text'), { _text: String(t) }), addEventListener() {}, hidden: false }
  const seenUrls = []; const fb = fakeFirebase(fbUsers)
  const ctx = { window: { GIDEON_CLOUD: cfg }, document: doc, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: (k) => { delete store[k] } }, atob: (s) => Buffer.from(s, 'base64').toString('binary'), URLSearchParams,
    fetch: async (url, o = {}) => { seenUrls.push(String(url)); const r = await fb(url, o); return r || fetch(url, o) },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), clearTimeout, setInterval: () => 0, clearInterval() {}, encodeURIComponent, Number, Array, Object, String, JSON, Math, Error, Promise }
  const logs = []; ctx.console = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) }
  vm.runInNewContext(script, ctx)
  return { els, logs, seenUrls, store }
}
const EP = { capabilities: '/api/cloud/capabilities', list: '/api/cloud/bots', connect: '/api/cloud/bots', bot: '/api/cloud/bots/{id}', action: '/api/cloud/bots/{id}/{action}', remove: '/api/cloud/bots/{id}', logs: '/api/cloud/bots/{id}/logs' }
const cfgFor = (port) => ({ API_BASE: 'http://127.0.0.1:' + port, FIREBASE: { apiKey: 'k', projectId: 'p' }, ENDPOINTS: EP })
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const cardsText = (els) => els.bots.children.map((c) => c.textContent).join('|')
let pass = 0, total = 0
const t = async (name, fn) => { total++; try { await fn(); pass++; console.log('PASS', name) } catch (e) { console.log('FAIL', name, '\n  ', e.message) } }
const credsFor = (num) => JSON.stringify({ noiseKey: {}, signedIdentityKey: {}, me: { id: `${num}:1@s.whatsapp.net` } })
const sidFor = (num) => 'Gideon~' + Buffer.from(credsFor(num)).toString('base64')
const press = async (els, sid, own, num) => { els.sid.value = sid; els.own.value = own; els.num.value = num; await els.form.fire('submit') }
const login = async (els, email, pw = 'pass123') => { els.em.value = email; els.pw.value = pw; await els.authForm.fire('submit'); await tick(300) }

;(async () => {
  await t('opens on the sign-in screen: dashboard hidden, pair button present', async () => {
    const b = await backend(); const { els } = setup(cfgFor(b.port)); await tick()
    assert(!els.auth.hidden); assert(els.app.hidden); assert(els.go.disabled)
    assert(/id="pair"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*href="https:\/\/praise-pair\.onrender\.com\/"/.test(html)); b.close()
  })
  await t('wrong password shows an error and stays signed out', async () => {
    const b = await backend(); const { els } = setup(cfgFor(b.port)); await login(els, 'a@x.com', 'nope'); assert(els['e-auth'].textContent.includes('incorrect')); assert(!els.auth.hidden); b.close()
  })
  await t('sign in -> dashboard; session id sent only in POST body, cleared, never in URL/logs/localStorage', async () => {
    const b = await backend(); const { els, logs, seenUrls, store } = setup(cfgFor(b.port)); await login(els, 'a@x.com')
    assert(els.auth.hidden && !els.app.hidden); assert(els.who.textContent === 'a@x.com'); assert(!els.go.disabled)
    const S = sidFor('2348012345678'); await press(els, S, 'Ada', '+234 801 234 5678'); await tick(500)
    assert(els.formMsg.textContent.includes('is online'), els.formMsg.textContent); assert.strictEqual(els.sid.value, '')
    assert(cardsText(els).includes('2348012345678') && cardsText(els).includes('Ada') && cardsText(els).includes('Online'))
    assert(!seenUrls.some((u) => u.includes('Gideon~')) && !logs.some((l) => l.includes('Gideon~')) && !JSON.stringify(store).includes('Gideon~')); b.close()
  })
  await t('remembered refresh token signs back in on reload', async () => {
    const b = await backend(); const { els } = setup(cfgFor(b.port), { token: 'rt:a@x.com' }); await tick(400); assert(!els.app.hidden && els.auth.hidden); b.close()
  })
  await t('unverified email: told to verify, connect disabled; sign up sends verification email', async () => {
    const b = await backend(); const { els } = setup(cfgFor(b.port)); await login(els, 'u@x.com'); assert(els.notice.textContent.includes('Verify your email')); assert(els.go.disabled)
    fakeFirebase.sent.length = 0; els.em.value = 'new@x.com'; els.pw.value = 'pass123'; await els.signup.fire('click'); await tick(300); assert(fakeFirebase.sent.includes('VERIFY_EMAIL')); b.close()
  })
  await t('bot actions, second independent bot, delete only that bot, manage drawer', async () => {
    const b = await backend(); const { els } = setup(cfgFor(b.port)); await login(els, 'a@x.com')
    await press(els, sidFor('2348012345678'), 'Ada', '2348012345678'); await tick(500); await press(els, sidFor('2348099999999'), 'Bola', '2348099999999'); await tick(500)
    assert.strictEqual(els.bots.children.length, 2)
    await els.bots.children[0].find((e) => e.textContent === 'STOP').fire('click'); await tick(300)
    assert(cardsText(els).split('|')[0].includes('Offline')); assert(cardsText(els).split('|')[1].includes('Online'))
    await els.bots.children[1].find((e) => e.textContent === 'MANAGE').fire('click'); await tick(300)
    assert(els.drawer.classList.contains('open') && els.sheet.textContent.includes('2m') && El.reg.logs.textContent.includes('ready'))
    await els.bots.children[1].find((e) => e.textContent === 'DELETE').fire('click'); await els.cYes.onclick(); await tick(400)
    assert.strictEqual(els.bots.children.length, 1); assert(cardsText(els).includes('Ada')); b.close()
  })
  await t("another user signing in sees none of A's bots", async () => {
    const b = await backend(); const A = setup(cfgFor(b.port)); await login(A.els, 'a@x.com'); await press(A.els, sidFor('2348012345678'), 'Ada', '2348012345678'); await tick(400)
    const Bu = setup(cfgFor(b.port)); await login(Bu.els, 'b@x.com'); assert(cardsText(Bu.els).includes('No bots')); b.close()
  })
  await t('backend never confirms online: UI never claims connected', async () => {
    const b = await backend({ never: true }); const { els } = setup(cfgFor(b.port)); await login(els, 'a@x.com')
    await press(els, sidFor('2348012345678'), 'Ada', '2348012345678'); await tick(600); assert(!els.formMsg.textContent.includes('is online')); assert(cardsText(els).includes('Connecting') && !cardsText(els).includes('Online')); b.close()
  })
  await t('rejected session / wrong number: backend error shown, nothing added', async () => {
    const b = await backend(); const { els } = setup(cfgFor(b.port)); await login(els, 'a@x.com')
    await press(els, sidFor('2348012345678'), 'Ada', '2348000000000'); await tick(300); assert(els.formMsg.classList.contains('bad') && els.formMsg.textContent.includes('different WhatsApp number')); assert(cardsText(els).includes('No bots')); b.close()
  })
  await t('sign out clears the session and shows sign-in again', async () => {
    const b = await backend(); const { els, store } = setup(cfgFor(b.port)); await login(els, 'a@x.com'); await els.out.fire('click'); await tick(); assert(!els.auth.hidden && els.app.hidden && !store['gc.rt']); b.close()
  })
  await t('plain-http remote API refused', async () => {
    const { els, seenUrls } = setup({ ...cfgFor(1), API_BASE: 'http://example.com/api' }, { token: 'rt:a@x.com' }); await tick(200); assert(els.notice.textContent.includes('https')); assert(!seenUrls.some((u) => u.includes('example.com')))
  })
  console.log(`\n${pass}/${total} passed`); process.exit(pass === total ? 0 : 1)
})()
