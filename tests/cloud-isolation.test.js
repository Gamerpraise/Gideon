// Every Cloud user is the main bot of their own number: what they change stays theirs. No network. Run: node tests/cloud-isolation.test.js
const ROOT = require('path').join(__dirname, '..'); process.chdir(ROOT)
require(require('path').join(ROOT, 'tests/stub-missing-modules.js'))
const fs = require('fs'), path = require('path'), assert = require('assert')
const config = require(path.join(ROOT, 'config')), store = require(path.join(ROOT, 'store')), als = require(path.join(ROOT, 'context'))
const rootDb = store.root(); const before = JSON.stringify(rootDb)
const dirs = ['cb_aaaaaaaaaaaa', 'cb_bbbbbbbbbbbb'].map((id) => { const d = path.join(ROOT, 'cloud-data', 'sessions', id); fs.mkdirSync(d, { recursive: true }); return d })
const A = als.forBot('cb_aaaaaaaaaaaa'), B = als.forBot('cb_bbbbbbbbbbbb')
const hostPrefix = config.prefix, hostAutoRead = config.autoRead
const run = (ctx, f) => als.run(ctx, f)
;(async () => {
  // settings commands write through config + store exactly like they do for the host
  run(A, () => { config.prefix = '!'; config.autoRead = !hostAutoRead; store.set('theme', 4); store.get().banned.push('2349000000000'); store.get().antilink['g@g.us'] = true; store.get().settings = { autoRead: config.autoRead }; store.save() })
  assert.strictEqual(config.prefix, hostPrefix, 'host prefix untouched'); assert.strictEqual(config.autoRead, hostAutoRead, 'host auto-read untouched')
  assert.strictEqual(store.get().theme, rootDb.theme); assert.deepStrictEqual(store.get().banned, rootDb.banned); assert.deepStrictEqual(store.get().antilink, rootDb.antilink)
  run(B, () => { assert.strictEqual(config.prefix, hostPrefix, 'other users untouched'); assert.strictEqual(store.get().theme, 1); assert.deepStrictEqual(store.get().banned, []); assert.deepStrictEqual(store.get().antilink, {}) })
  run(A, () => { assert.strictEqual(config.prefix, '!'); assert.strictEqual(store.get().theme, 4); assert.strictEqual(store.get().owners.length, 0, 'the host owner is not an owner here') })
  // survives a restart: the user's own file
  store.flush(); assert(fs.existsSync(path.join(dirs[0], 'db.json')))
  store.dropBot('cb_aaaaaaaaaaaa'); const again = store.bot('cb_aaaaaaaaaaaa'); assert.strictEqual(again.data.theme, 4)
  // async work started inside a context keeps it (timers, awaits)
  await run(B, async () => { await new Promise((r) => setTimeout(r, 15)); store.set('theme', 7); assert.strictEqual(config.prefix, hostPrefix) })
  assert.strictEqual(store.bot('cb_bbbbbbbbbbbb').data.theme, 7); assert.strictEqual(rootDb.theme, 1)
  // deleting a bot forgets its context and database
  als.drop('cb_bbbbbbbbbbbb'); assert(!als.all().some((c) => c.id === 'cb_bbbbbbbbbbbb'))
  // the host's database never changed
  assert.strictEqual(JSON.stringify(rootDb), before, 'host database identical')
  // developer commands are the host-only ones; every other owner command is open to Cloud users
  require(path.join(ROOT, 'handler')).loadCommands()
  const all = []; for (const f of fs.readdirSync(path.join(ROOT, 'commands'))) { if (!f.endsWith('.js')) continue; all.push(...[].concat(require(path.join(ROOT, 'commands', f)))) }
  const dev = all.filter((c) => c.dev).map((c) => c.name).sort()
  assert.deepStrictEqual(dev, ['clear', 'eval', 'exec', 'restart', 'update'])
  for (const n of ['setprefix', 'theme', 'autoread', 'ban', 'antidelete', 'autoreply', 'pair', 'premium', 'public', 'self', 'broadcast', 'getsession', 'server', 'allowdev']) assert(all.find((c) => c.name === n && !c.dev), n + ' open to Cloud users')
  // .getsession gives a Cloud user THEIR OWN session as a Gideon~ ID (never the host's)
  const creds = { noiseKey: {}, signedIdentityKey: {}, me: { id: '2348055555555:2@s.whatsapp.net' } }; fs.writeFileSync(path.join(dirs[0], 'creds.json'), JSON.stringify(creds))
  const sent = []; const gs = all.find((c) => c.name === 'getsession')
  await gs.run({ isCloud: true, botId: 'cb_aaaaaaaaaaaa', manager: { get: () => ({ sessionDir: dirs[0] }) }, sendMessage: async (c, x) => sent.push(x) }, { isGroup: false, chat: 'c', reply: async (x) => sent.push({ text: x }) })
  const gid = String(sent[0].text).match(/Gideon~\S+/)[0]; assert.strictEqual(require(path.join(ROOT, 'sessionid')).decodeSession(gid).number, '2348055555555', 'own session, decodable')
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  for (const d of ['sessions', '']) { try { fs.rmdirSync(path.join(ROOT, 'cloud-data', d)) } catch {} } // only if empty: never touches real data
  console.log('cloud isolation OK'); process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
