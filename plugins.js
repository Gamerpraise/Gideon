// Optional signed plugins from the admin File Manager.
// OFF by default. Turn on ONLY in config.local.json: { "allowPlugins": true, "pluginPublicKey": "-----BEGIN PUBLIC KEY-----..." }
// A plugin is loaded only if ALL of these hold: the host opted in, the server signature verifies against the
// public key the host configured, the sha256 matches, it passes the same static screening the server applied,
// it exports the command interface (name + run), and it does not replace an existing command.
// It is a safety net, not a sandbox: only enable plugins you trust the publisher of.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('./config')
const net = require('./network')

const dir = path.join(__dirname, 'plugins')
const FORBIDDEN = [
  /\brequire\s*\(\s*['"`](child_process|cluster|vm|worker_threads|net|dgram|tls|http2?|https|fs\/promises|module)['"`]/, /\bprocess\s*\.\s*(env|binding|kill|exit|dlopen|mainModule)/,
  /\beval\s*\(/, /\bnew\s+Function\s*\(/, /\bchild_process\b/, /\brequire\s*\(\s*[^'"`\s)]/, /\bimport\s*\(/,
  /\bfs\s*\.\s*(writeFile|writeFileSync|unlink|unlinkSync|rm|rmSync|rmdir|rename|appendFile|createWriteStream)/, /session\/|creds\.json|database\.json|config\.local/
]
const loaded = new Map() // file -> sha256

async function sync() {
  if (!config.allowPlugins || !config.pluginPublicKey || !net.configured()) return { skipped: true }
  const handler = require('./handler')
  const res = await net.call('get', '/plugins')
  if (!res.ok || res.distribution !== 'signed') return { skipped: true }
  const pub = crypto.createPublicKey(config.pluginPublicKey)
  fs.mkdirSync(dir, { recursive: true })
  const out = []
  for (const p of res.plugins || []) {
    try {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\.js$/.test(p.name)) throw new Error('bad name')
      const buf = Buffer.from(p.contentBase64, 'base64')
      const digest = crypto.createHash('sha256').update(buf).digest('hex')
      if (digest !== p.sha256) throw new Error('hash mismatch')
      if (!crypto.verify(null, Buffer.from(`${p.name}:${p.version}:${p.sha256}`), pub, Buffer.from(p.signature, 'base64'))) throw new Error('bad signature')
      const src = buf.toString('utf8')
      if (FORBIDDEN.some((re) => re.test(src))) throw new Error('failed screening')
      if (loaded.get(p.name) === digest) continue
      const file = path.join(dir, p.name)
      fs.writeFileSync(file, src)
      delete require.cache[require.resolve(file)]
      const mod = require(file)
      const mods = Array.isArray(mod) ? mod : [mod]
      for (const m of mods) {
        if (!m || typeof m.name !== 'string' || typeof m.run !== 'function') throw new Error('does not match the command interface')
        const existing = handler.getCommand(m.name)
        if (existing && !existing.__plugin) throw new Error(`"${m.name}" would replace a built-in command`)
        m.__plugin = true
        handler.registerCommand(m)
      }
      loaded.set(p.name, digest)
      out.push(p.name)
    } catch (e) {
      console.log(`[plugins] ${p.name}: not loaded (${e.message})`)
    }
  }
  return { loaded: out }
}
module.exports = { sync }
