// Firebase copy of Cloud users: encrypted, restored on a wiped host, deleted on logout. Fake Firestore, no network.
const ROOT = require('path').join(__dirname, '..'); process.chdir(ROOT)
require(require('path').join(ROOT, 'tests/stub-missing-modules.js'))
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), assert = require('assert')
const { createStore, loadServiceAccount } = require(path.join(ROOT, 'cloudstore'))
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const sa = { client_email: 'svc@test.iam.gserviceaccount.com', private_key: privateKey, project_id: 'test-proj' }

// ---- a tiny Firestore: documents by path, the REST shapes cloudstore.js uses
const docs = new Map(); let tokenCalls = 0, writes = 0
const fakeFetch = async (url, opts = {}) => {
  url = String(url); const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b })
  if (url === 'https://oauth2.googleapis.com/token') {
    tokenCalls++
    const jwt = new URLSearchParams(opts.body).get('assertion').split('.')
    assert(crypto.verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), publicKey, Buffer.from(jwt[2], 'base64url')), 'service-account JWT is signed')
    const claims = JSON.parse(Buffer.from(jwt[1], 'base64url')); assert.strictEqual(claims.iss, sa.client_email); assert(/datastore/.test(claims.scope))
    return json({ access_token: 'tok', expires_in: 3600 })
  }
  assert.strictEqual(opts.headers.authorization, 'Bearer tok')
  const rel = decodeURIComponent(url.split('/documents/')[1]).split('?')[0]; const q = new URL(url).searchParams
  const method = opts.method || 'GET'
  if (method === 'PATCH') { writes++; docs.set(rel, JSON.parse(opts.body).fields); return json({}) }
  if (method === 'DELETE') { docs.delete(rel); return json({}) }
  if (/^cloudBots$/.test(rel)) { // list, paged
    const all = [...docs.keys()].filter((k) => /^cloudBots\/[^/]+$/.test(k)).sort(); const start = Number(q.get('pageToken') || 0), size = Number(q.get('pageSize'))
    const slice = all.slice(start, start + size)
    return json({ documents: slice.map((k) => ({ name: `projects/test-proj/databases/(default)/documents/${k}`, fields: docs.get(k) })), nextPageToken: start + size < all.length ? String(start + size) : undefined })
  }
  return docs.has(rel) ? json({ name: rel, fields: docs.get(rel) }) : json({}, 404)
}
const mkStore = (extra = {}) => createStore({ serviceAccount: sa, fetchImpl: fakeFetch, ...extra })
const ID = 'cb_aaaaaaaaaaaa', ID2 = 'cb_bbbbbbbbbbbb', ID3 = 'cb_cccccccccccc'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  assert.strictEqual(loadServiceAccount('nope'), null); assert.strictEqual(loadServiceAccount(Buffer.from(JSON.stringify(sa)).toString('base64')).project_id, 'test-proj'); assert.strictEqual(loadServiceAccount(JSON.stringify(sa)).project_id, 'test-proj')
  const st = mkStore(); const rec = { id: ID, uid: 'u1', number: '2348012345678', createdAt: 1, autostart: true }
  const files = { 'creds.json': Buffer.from('{"secret":"WHATSAPP-SESSION-SECRET"}'), 'pre-key-1.json': Buffer.from('k1'), 'db.json': Buffer.from('{"theme":4}') }
  assert.strictEqual(await st.put(ID, rec, files), true); assert.strictEqual(await st.put(ID, rec, files), false, 'identical data is not uploaded again')
  const stored = JSON.stringify([...docs.values()]); assert(!stored.includes('WHATSAPP-SESSION-SECRET') && !stored.includes(Buffer.from('WHATSAPP-SESSION-SECRET').toString('base64')), 'Firebase only ever sees encrypted data')
  const back = await st.get(ID); assert.deepStrictEqual(back.rec, rec); assert.strictEqual(back.files['creds.json'].toString(), '{"secret":"WHATSAPP-SESSION-SECRET"}'); assert.strictEqual(back.files['db.json'].toString(), '{"theme":4}')
  assert.strictEqual(tokenCalls, 1, 'the access token is reused')
  assert.throws(() => mkStore({ passphrase: 'wrong' })._open(st._seal(files)), 'a different key cannot read it')
  // big sessions are split in several documents, and shrinking removes the extra pieces
  const big = { 'creds.json': Buffer.from('{}'), 'blob.bin': crypto.randomBytes(900 * 1024) }
  await st.put(ID2, { ...rec, id: ID2 }, big); const chunks = () => [...docs.keys()].filter((k) => k.startsWith(`cloudBots/${ID2}/chunks/`)).length
  assert(chunks() >= 2, 'split into chunks'); assert.deepStrictEqual((await st.get(ID2)).files['blob.bin'], big['blob.bin'])
  await st.put(ID2, { ...rec, id: ID2 }, { 'creds.json': Buffer.from('{}') }); assert.strictEqual(chunks(), 1, 'old chunks removed')
  await st.put(ID3, { ...rec, id: ID3 }, { 'creds.json': Buffer.from('{}') })
  assert.deepStrictEqual((await st.list()).map((x) => x.id).sort(), [ID, ID2, ID3], 'listing walks every page')
  await st.remove(ID2); assert(![...docs.keys()].some((k) => k.includes(ID2)), 'remove deletes the record and every chunk'); await st.remove(ID3)

  // ---- inside cloud.js: back up, lose the disk, come back; logout deletes it from Firebase
  const { createCloud } = require(path.join(ROOT, 'cloud'))
  const mkManager = () => { const opened = []; return { opened, cloud: { open: async (id) => opened.push(id) }, get: () => null, removeChildren: async () => {}, listChildren: () => [] } }
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-a-')), dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-b-'))
  const mA = mkManager(); const svcA = createCloud({ manager: mA, dataDir: dirA, cfg: { ...require(path.join(ROOT, 'config')).cloud, backupDelayMs: 30 }, verify: async () => ({}), log: () => {}, store: mkStore() })
  fs.mkdirSync(path.join(dirA, 'sessions', ID), { recursive: true }); for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dirA, 'sessions', ID, n), b)
  svcA.meta().bots[ID] = rec
  const before = writes; mA.cloud.dirty(ID); await wait(300); assert(writes > before, 'a changed session is copied to Firebase after the delay')
  const mB = mkManager(); const svcB = createCloud({ manager: mB, dataDir: dirB, verify: async () => ({}), log: () => {}, store: mkStore() }) // a new host, empty disk
  const realST = global.setTimeout; global.setTimeout = (f) => realST(f, 0); await svcB.restore(); global.setTimeout = realST; await wait(50)
  assert.strictEqual(fs.readFileSync(path.join(dirB, 'sessions', ID, 'creds.json'), 'utf8'), '{"secret":"WHATSAPP-SESSION-SECRET"}', 'session restored from Firebase')
  assert.strictEqual(svcB.meta().bots[ID].uid, 'u1'); assert.deepStrictEqual(mB.opened, [ID], 'and the bot is started again')
  // a user who logged out: gone from disk AND Firebase
  await mB.cloud.onLoggedOut(ID); assert(!fs.existsSync(path.join(dirB, 'sessions', ID)) && !svcB.meta().bots[ID]); assert(![...docs.keys()].some((k) => k.includes(ID)), 'nothing left in Firebase')
  // without Firebase configured everything still works on the disk alone
  const svcC = createCloud({ manager: mkManager(), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cs-c-')), verify: async () => ({}), log: () => {}, store: null }); await svcC.restore(); await svcC.forget(ID)
  for (const d of [dirA, dirB]) fs.rmSync(d, { recursive: true, force: true })
  console.log('cloud store OK'); process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
