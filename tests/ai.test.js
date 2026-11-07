// .gideonai keeps answering when a provider is dead. No network (fetch is faked). Run: node tests/ai.test.js
const ROOT = require('path').join(__dirname, '..'); process.chdir(ROOT)
require(require('path').join(ROOT, 'tests/stub-missing-modules.js'))
const assert = require('assert'), path = require('path')
const calls = []; let mode = 'pollinations-ok'
global.fetch = async (url, opts = {}) => {
  calls.push(String(url).split('?')[0])
  const reply = (body, ok = true) => ({ ok, status: ok ? 200 : 500, text: async () => body })
  if (/generativelanguage/.test(url)) return mode === 'gemini-ok' ? reply(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini says hi' }] } }] })) : reply('{}', false)
  if (/pollinations/.test(url)) return mode === 'pollinations-ok' ? reply('pollinations says hi') : reply('down', false)
  if (/siputzx/.test(url)) return mode === 'siputzx-ok' ? reply(JSON.stringify({ status: true, data: 'siputzx says hi' })) : reply('down', false)
  throw new Error('offline')
}
require(path.join(ROOT, 'functions')).fetchJson = async () => ({ AbstractText: '' }) // the DuckDuckGo lookup (axios is stubbed in tests)
const { ask } = require(path.join(ROOT, 'aiclient'))
;(async () => {
  delete process.env.GEMINI_API_KEY
  assert.strictEqual(await ask('hello'), 'pollinations says hi'); assert(!calls.some((c) => /generativelanguage/.test(c)), 'no Gemini call without a key')
  mode = 'siputzx-ok'; assert.strictEqual(await ask('hello'), 'siputzx says hi', 'falls through a dead provider')
  mode = 'all-dead'; assert.strictEqual(await ask('hello'), null)
  process.env.GEMINI_API_KEY = 'k'; mode = 'gemini-ok'; calls.length = 0; assert.strictEqual(await ask('hello'), 'gemini says hi'); assert(/generativelanguage/.test(calls[0]), 'Gemini first when a key is set')
  mode = 'pollinations-ok'; assert.strictEqual(await ask('hello', 'ctx'), 'pollinations says hi', 'Gemini failing falls back')
  // the command: answer, or at least the web summary when every AI is down
  const cmd = [].concat(require(path.join(ROOT, 'commands/ai.js'))).find((c) => c.name === 'gideonai'); const out = []
  const m = { react: async () => {}, reply: async (x) => out.push(x), quoted: null }
  mode = 'pollinations-ok'; await cmd.run({}, m, { args: ['hi'], text: 'what is 2+2', config: { prefix: '.' } }); assert.strictEqual(out.pop(), 'pollinations says hi')
  mode = 'all-dead'; await cmd.run({}, m, { args: ['hi'], text: 'what is 2+2', config: { prefix: '.' } }); assert(/busy/i.test(out.pop()))
  console.log('ai OK'); process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
