// GIDEON CLOUD backend tests: node tests/cloud.test.js   (no dependencies, no WhatsApp connection)
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), assert = require('assert'), http = require('http')
const { createCloud, decodeSession, verifyFirebaseToken } = require('../cloud')

const creds = (num) => JSON.stringify({ noiseKey: { private: { type: 'Buffer', data: 'AA==' } }, signedIdentityKey: { private: { type: 'Buffer', data: 'AA==' } }, me: { id: `${num}:12@s.whatsapp.net`, name: 'x' }, registered: true })
const sid = (num, how = 'base64') => 'Gideon~' + (how === 'gzip' ? zlib.gzipSync(creds(num)).toString('base64') : Buffer.from(creds(num)).toString(how))

// fake bot manager: same surface cloud.js uses (manager.get/list/cloud.open|stop|close)
function fakeManager() {
  const bots = new Map()
  return {
    bots, get: (id) => bots.get(id), list: () => [...bots.values()],
    cloud: {
      async open(id) { const old = bots.get(id); if (old) await old.stop?.(); const c = { id, cloud: true, stopped: false, status: 'connecting', lastError: '', openedAt: 0, logs: ['starting'] }; c.stop = async () => { c.stopped = true; c.status = 'offline' }; bots.set(id, c); setTimeout(() => { if (!c.stopped && !c.noOnline) { c.status = 'online'; c.openedAt = Date.now() - 125000 } }, 20); return c },
      async stop(id) { const c = bots.get(id); if (!c) return false; await c.stop(); return true },
      async close(id) { const c = bots.get(id); if (!c) return false; bots.delete(id); return true }
    }
  }
}
const users = { 'tok-a': { uid: 'uA', email: 'a@x.com', emailVerified: true }, 'tok-b': { uid: 'uB', email: 'b@x.com', emailVerified: true }, 'tok-u': { uid: 'uU', email: 'u@x.com', emailVerified: false } }
const verify = async (t) => { if (!users[t]) throw new Error('no'); return users[t] }
async function boot(cfg = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-')); const manager = fakeManager(); const logs = []
  const svc = createCloud({ manager, dataDir: dir, verify, log: (m) => logs.push(m), cfg: { maxBotsPerUser: 3, maxBots: 20, requireVerifiedEmail: true, allowedOrigins: [], ...cfg } })
  await new Promise((r) => svc.server.listen(0, r)); const port = svc.server.address().port
  const call = (method, p, tok, body) => new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch {} resolve({ status: res.statusCode, body: j, text: b, headers: res.headers }) }) })
    if (data) req.write(data); req.end()
  })
  return { dir, manager, svc, call, logs, close: () => svc.server.close() }
}
let pass = 0, total = 0
const t = async (name, fn) => { total++; try { await fn(); pass++; console.log('PASS', name) } catch (e) { console.log('FAIL', name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')) } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const B = '/api/cloud/bots'

;(async () => {
  await t('decodeSession: base64, base64url, gzip, raw JSON', () => {
    for (const how of ['base64', 'base64url', 'gzip']) assert.strictEqual(decodeSession(sid('2348012345678', how)).number, '2348012345678')
    assert.strictEqual(decodeSession('Gideon~' + creds('2348012345678')).number, '2348012345678')
  })
  await t('decodeSession: rejects junk, wrong prefix, non-creds JSON, oversize', () => {
    for (const bad of ['', 'abc', 'Gideon~', 'Gideon~!!!notbase64!!!', 'Other~' + Buffer.from(creds('2348012345678')).toString('base64'), 'Gideon~' + Buffer.from('{"a":1}').toString('base64'), 'Gideon~' + 'A'.repeat(500000)]) assert.throws(() => decodeSession(bad), bad.slice(0, 20))
  })

  await t('verifyFirebaseToken: valid, wrong project, expired, tampered, wrong key', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' }
    const mk = (over = {}, key = privateKey) => { const now = Math.floor(Date.now() / 1000); const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url'); const p = Buffer.from(JSON.stringify({ iss: 'https://securetoken.google.com/proj', aud: 'proj', sub: 'u1', iat: now, exp: now + 3600, email: 'a@b.c', email_verified: true, ...over })).toString('base64url'); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}` }
    const getKey = async (kid) => (kid === 'k1' ? jwk : null)
    assert.deepStrictEqual(await verifyFirebaseToken(mk(), 'proj', getKey), { uid: 'u1', email: 'a@b.c', emailVerified: true })
    for (const bad of [mk({ aud: 'other' }), mk({ iss: 'https://evil' }), mk({ exp: 1 }), mk({ sub: '' }), mk({}, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey), mk().slice(0, -4) + 'AAAA', 'a.b.c', '']) await assert.rejects(verifyFirebaseToken(bad, 'proj', getKey))
    const none = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url'); await assert.rejects(verifyFirebaseToken(`${none}.${mk().split('.')[1]}.`, 'proj', getKey))
  })

  await t('API: no / bad token -> 401; unverified email -> 403', async () => {
    const s = await boot(); assert.strictEqual((await s.call('GET', B)).status, 401); assert.strictEqual((await s.call('GET', B, 'nope')).status, 401)
    const r = await s.call('GET', B, 'tok-u'); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'EMAIL_UNVERIFIED'); s.close()
  })
  await t('connect: stores creds privately, returns no secrets, never logs session', async () => {
    const s = await boot(); const S = sid('2348012345678')
    const r = await s.call('POST', B, 'tok-a', { sessionId: S, ownerName: 'Ada', ownerNumber: '+234 801 234 5678' })
    assert.strictEqual(r.status, 201); assert.strictEqual(r.body.bot.status, 'connecting'); assert.strictEqual(r.body.bot.ownerName, 'Ada'); assert(/^cb_[0-9a-f]{12}$/.test(r.body.bot.id))
    assert(!r.text.includes('Gideon~') && !r.text.includes('noiseKey')); assert(!s.logs.join('\n').includes('2348012345678') && !s.logs.join('').includes('Gideon~'))
    const file = path.join(s.dir, 'sessions', r.body.bot.id, 'creds.json'); assert.strictEqual(fs.readFileSync(file, 'utf8'), creds('2348012345678')); assert.strictEqual(fs.statSync(file).mode & 0o077, 0)
    assert(!fs.readFileSync(path.join(s.dir, 'bots.json'), 'utf8').includes('noiseKey'))
    await wait(80); const g = await s.call('GET', `${B}/${r.body.bot.id}`, 'tok-a'); assert.strictEqual(g.body.bot.status, 'online'); assert(g.body.bot.uptimeSeconds >= 120); s.close()
  })
  await t('connect: validation, number mismatch, duplicate number, per-user limit', async () => {
    const s = await boot({ maxBotsPerUser: 2 }); const post = (b, tok = 'tok-a') => s.call('POST', B, tok, b)
    assert.strictEqual((await post({ sessionId: 'x', ownerName: 'A', ownerNumber: '2348012345678' })).status, 400)
    assert.strictEqual((await post({ sessionId: sid('2348012345678'), ownerName: '', ownerNumber: '2348012345678' })).status, 400)
    const mm = await post({ sessionId: sid('2348012345678'), ownerName: 'A', ownerNumber: '2348000000000' }); assert.strictEqual(mm.status, 400); assert(!mm.text.includes('2348012345678')); assert.strictEqual(Object.keys(s.svc.meta().bots).length, 0)
    assert.strictEqual((await post({ sessionId: sid('2348012345678'), ownerName: 'A', ownerNumber: '2348012345678' })).status, 201)
    assert.strictEqual((await post({ sessionId: sid('2348012345678'), ownerName: 'A', ownerNumber: '2348012345678' }, 'tok-b')).status, 409)
    assert.strictEqual((await post({ sessionId: sid('2348011111111'), ownerName: 'B', ownerNumber: '2348011111111' })).status, 201)
    assert.strictEqual((await post({ sessionId: sid('2348022222222'), ownerName: 'C', ownerNumber: '2348022222222' })).status, 403); s.close()
  })
  await t('isolation: user B cannot see or control user A bots (404, same as missing)', async () => {
    const s = await boot(); const a = (await s.call('POST', B, 'tok-a', { sessionId: sid('2348012345678'), ownerName: 'A', ownerNumber: '2348012345678' })).body.bot.id
    assert.strictEqual((await s.call('GET', B, 'tok-b')).body.bots.length, 0); assert.strictEqual((await s.call('GET', B, 'tok-a')).body.bots.length, 1)
    const missing = await s.call('GET', `${B}/cb_000000000000`, 'tok-b')
    for (const [m, p] of [['GET', `${B}/${a}`], ['GET', `${B}/${a}/logs`], ['POST', `${B}/${a}/stop`], ['POST', `${B}/${a}/restart`], ['DELETE', `${B}/${a}`]]) { const r = await s.call(m, p, 'tok-b'); assert.strictEqual(r.status, 404, m + p); assert.deepStrictEqual(r.body, missing.body) }
    assert.strictEqual(s.manager.get(a).stopped, false); assert(fs.existsSync(path.join(s.dir, 'sessions', a))); s.close()
  })
  await t('actions: stop, start, restart, logs, delete (logs out + removes files)', async () => {
    const s = await boot(); const id = (await s.call('POST', B, 'tok-a', { sessionId: sid('2348012345678'), ownerName: 'A', ownerNumber: '2348012345678' })).body.bot.id; await wait(80)
    assert.strictEqual((await s.call('POST', `${B}/${id}/stop`, 'tok-a')).body.bot.status, 'offline'); assert.strictEqual((await s.call('GET', B, 'tok-a')).body.bots[0].status, 'offline')
    assert.strictEqual((await s.call('POST', `${B}/${id}/start`, 'tok-a')).status, 200); await wait(80); assert.strictEqual((await s.call('GET', `${B}/${id}`, 'tok-a')).body.bot.status, 'online')
    assert.strictEqual((await s.call('POST', `${B}/${id}/restart`, 'tok-a')).status, 200); assert.strictEqual((await s.call('POST', `${B}/${id}/explode`, 'tok-a')).status, 404)
    assert(Array.isArray((await s.call('GET', `${B}/${id}/logs`, 'tok-a')).body.lines))
    assert.strictEqual((await s.call('DELETE', `${B}/${id}`, 'tok-a')).status, 200); assert(!fs.existsSync(path.join(s.dir, 'sessions', id))); assert.strictEqual(s.manager.get(id), undefined); assert.strictEqual((await s.call('GET', B, 'tok-a')).body.bots.length, 0); s.close()
  })
  await t('error status from the engine is shown, not hidden', async () => {
    const s = await boot(); const id = (await s.call('POST', B, 'tok-a', { sessionId: sid('2348012345678'), ownerName: 'A', ownerNumber: '2348012345678' })).body.bot.id
    const c = s.manager.get(id); c.noOnline = true; c.status = 'error'; c.lastError = 'WhatsApp logged this device out.'
    const g = (await s.call('GET', `${B}/${id}`, 'tok-a')).body.bot; assert.strictEqual(g.status, 'error'); assert(g.error.includes('logged')); s.close()
  })
  await t('static: only dashboard files are served; config.js, database.json, traversal blocked', async () => {
    const s = await boot()
    for (const p of ['/', '/index.html', '/cloud-config.js']) { const r = await s.call('GET', p); assert.strictEqual(r.status, 200, p); assert(r.headers['content-security-policy']) }
    assert(!(await s.call('GET', '/cloud-config.js')).text.includes('networkKey'))
    for (const p of ['/config.js', '/database.json', '/session/creds.json', '/cloud-data/bots.json', '/../config.js', '/%2e%2e/config.js', '/package.json', '/bot.js', '/.env']) assert.strictEqual((await s.call('GET', p)).status, 404, p)
    s.close()
  })
  await t('rate limit and body size limit', async () => {
    const s = await boot(); const big = await s.call('POST', B, 'tok-a', { sessionId: 'Gideon~' + 'A'.repeat(400000), ownerName: 'A', ownerNumber: '2348012345678' }); assert.strictEqual(big.status, 413)
    for (let i = 0; i < 6; i++) await s.call('POST', B, 'tok-a', { sessionId: 'x', ownerName: 'A', ownerNumber: '2348012345678' }); assert.strictEqual((await s.call('POST', B, 'tok-a', { sessionId: 'x', ownerName: 'A', ownerNumber: '2348012345678' })).status, 429); s.close()
  })
  await t('restore: bots that were running come back, stopped ones stay stopped', async () => {
    const s = await boot(); const mk = async (n) => (await s.call('POST', B, 'tok-a', { sessionId: sid(n), ownerName: 'A', ownerNumber: n })).body.bot.id
    const a = await mk('2348012345678'), b = await mk('2348011111111'); await s.call('POST', `${B}/${b}/stop`, 'tok-a')
    const m2 = fakeManager(); const svc2 = createCloud({ manager: m2, dataDir: s.dir, verify, log() {}, cfg: { maxBotsPerUser: 3, maxBots: 20 } }); const calls = []; const orig = m2.cloud.open; m2.cloud.open = async (id, d) => { calls.push(id); return orig(id, d) }
    const realST = global.setTimeout; global.setTimeout = (f) => realST(f, 0); svc2.restore(); global.setTimeout = realST; await wait(50)
    assert.deepStrictEqual(calls, [a]); s.close()
  })
  console.log(`\n${pass}/${total} passed`); process.exit(pass === total ? 0 : 1)
})()
