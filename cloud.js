// GIDEON CLOUD: the dashboard (served at /) and its API (/api/cloud/*), running inside the bot process
// so it can control the same bot manager as .pair. No new dependencies.
//
// Sign-in reuses the existing Firebase Authentication project: the browser signs in with Firebase and sends
// the ID token; this file verifies it against Google's public keys. Every bot record carries its owner's
// Firebase uid and every request is checked against it, so a user can only ever see and control their own bots.
// A Session ID (Gideon~...) is only ever read from the POST body, written to that bot's own creds.json and
// never logged, returned, put in a URL or stored anywhere else.
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const zlib = require('zlib')
const https = require('https')
const config = require('./config')

const ROOT = __dirname
const ID_RE = /^cb_[0-9a-f]{12}$/
const HTML = ['index.html', 'text/html; charset=utf-8']
// The ONLY files that can ever be served. config.js, database.json, session folders etc. are not reachable.
const STATIC = { '/': HTML, '/index.html': HTML, '/cloud-config.js': ['cloud-config.js', 'text/javascript; charset=utf-8'] }

// ------------------------------------------------------------------ Session ID (Gideon~...)
// The pairing site is not part of this project, so the decoder is deliberately tolerant: base64 / base64url,
// optionally gzipped, containing the creds.json text. Anything else is rejected, never guessed at.
function decodeSession(input) {
  const raw = String(input || '').trim()
  if (!/^Gideon~/.test(raw) || raw.length > 400000) throw new Error('bad')
  const body = raw.slice('Gideon~'.length).trim()
  const tries = []
  if (body.startsWith('{')) tries.push(Buffer.from(body, 'utf8'))
  for (const enc of ['base64', 'base64url']) {
    try { tries.push(Buffer.from(body, enc)) } catch {}
  }
  for (let buf of tries) {
    try {
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 5e6 })
      const text = buf.toString('utf8')
      const creds = JSON.parse(text)
      const me = String(creds?.me?.id || '')
      const number = me.split(':')[0].split('@')[0].replace(/\D/g, '')
      if (creds && typeof creds === 'object' && creds.noiseKey && creds.signedIdentityKey && number.length >= 8) return { text, number }
    } catch {}
  }
  throw new Error('This Session ID could not be read. Generate a new one with the pair code button and paste the whole thing.')
}

// ------------------------------------------------------------------ Firebase ID token verification
const b64u = (s) => Buffer.from(s, 'base64url').toString('utf8')
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy() })
      res.on('end', () => { try { resolve({ data: JSON.parse(body), headers: res.headers }) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
  })
}
const keyCache = { keys: {}, at: 0, ttl: 3600e3, tried: 0 }
async function googleKey(kid) {
  const fresh = Date.now() - keyCache.at < keyCache.ttl
  if (keyCache.keys[kid] && fresh) return keyCache.keys[kid]
  if (Date.now() - keyCache.tried < 60e3) return keyCache.keys[kid] || null // never hammer Google
  keyCache.tried = Date.now()
  const res = await getJson('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
  keyCache.keys = Object.fromEntries((res.data.keys || []).map((k) => [k.kid, k]))
  const m = /max-age=(\d+)/.exec(res.headers['cache-control'] || '')
  keyCache.ttl = (m ? Number(m[1]) : 3600) * 1000
  keyCache.at = Date.now()
  return keyCache.keys[kid] || null
}
async function verifyFirebaseToken(token, projectId, getKey = googleKey) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new Error('bad token')
  const header = JSON.parse(b64u(parts[0]))
  const p = JSON.parse(b64u(parts[1]))
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad token')
  const jwk = await getKey(header.kid)
  if (!jwk) throw new Error('unknown key')
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))
  const now = Date.now() / 1000
  if (!ok || p.aud !== projectId || p.iss !== `https://securetoken.google.com/${projectId}` || !p.sub || typeof p.sub !== 'string' || !(p.exp > now) || p.iat > now + 300) throw new Error('bad token')
  return { uid: p.sub, email: p.email || '', emailVerified: p.email_verified === true }
}

// ------------------------------------------------------------------ the service
function createCloud({ manager, dataDir, cfg = config.cloud, botName = config.botName, verify, log = console.log }) {
  const sessionsDir = path.join(dataDir, 'sessions')
  const metaFile = path.join(dataDir, 'bots.json')
  fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 })
  let meta = { bots: {} }
  try { meta = { bots: {}, ...JSON.parse(fs.readFileSync(metaFile, 'utf8')) } } catch {}
  const save = () => {
    const tmp = metaFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(meta), { mode: 0o600 })
    fs.renameSync(tmp, metaFile)
  }
  verify = verify || ((t) => verifyFirebaseToken(t, cfg.firebaseProjectId))
  const dirOf = (id) => path.join(sessionsDir, id)

  // ---- tiny in-memory rate limiter
  const hits = new Map()
  const limited = (key, max, windowMs) => {
    const now = Date.now()
    const h = hits.get(key)
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return false }
    return ++h.n > max
  }
  setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k) }, 60e3).unref?.()

  const busy = new Set() // per-bot / per-number locks
  // WhatsApp told us the user logged this device out: the session is useless now, so delete it from disk and
  // forget the bot. (Called by bot.js. A user pressing STOP never reaches this; STOP keeps the session.)
  manager.cloud.onLoggedOut = (id) => {
    if (!meta.bots[id]) return
    fs.rmSync(dirOf(id), { recursive: true, force: true })
    delete meta.bots[id]
    save()
    log(`[cloud] bot ${id} logged out of WhatsApp, session deleted`)
  }
  const mine = (uid) => Object.values(meta.bots).filter((b) => b.uid === uid)
  const owned = (uid, id) => (ID_RE.test(id) && meta.bots[id]?.uid === uid ? meta.bots[id] : null) // other users' ids look exactly like missing ones

  function view(rec) {
    const ctl = manager.get(rec.id)
    const live = ctl && ctl.cloud
    const status = live ? (ctl.stopped ? 'offline' : ctl.status) : 'offline'
    return {
      id: rec.id, name: botName, number: rec.number, ownerName: rec.ownerName, status,
      error: live && status !== 'online' ? ctl.lastError || '' : '',
      uptimeSeconds: live && status === 'online' && ctl.openedAt ? Math.floor((Date.now() - ctl.openedAt) / 1000) : null
    }
  }

  function takenNumbers() {
    const set = new Set(Object.values(meta.bots).map((b) => b.number))
    set.add(String(config.ownerNumber).replace(/\D/g, ''))
    for (const c of manager.list()) {
      if (/^\d+$/.test(c.id)) set.add(c.id)
      const jid = c.sock?.user?.id
      if (jid) set.add(String(jid).split(':')[0].split('@')[0])
    }
    return set
  }

  // ---- handlers (all receive the verified user)
  const H = {
    async capabilities() { return { status: 200, body: { actions: ['start', 'stop', 'restart', 'delete'], logs: true, maxBots: cfg.maxBotsPerUser } } },

    async list(user) { return { status: 200, body: { bots: mine(user.uid).map(view) } } },

    async connect(user, body) {
      if (limited('connect:' + user.uid, 6, 10 * 60e3)) return { status: 429, body: { error: 'Too many attempts. Wait a few minutes and try again.' } }
      const ownerName = String(body.ownerName || '').trim().slice(0, 40)
      const ownerNumber = String(body.ownerNumber || '').replace(/\D/g, '')
      if (typeof body.sessionId !== 'string' || !ownerName || ownerNumber.length < 8 || ownerNumber.length > 15) return { status: 400, body: { error: 'Session ID, owner name and owner number are required.' } }
      let session
      try { session = decodeSession(body.sessionId) } catch (e) { return { status: 400, body: { error: e.message === 'bad' ? 'Paste the full Session ID that starts with Gideon~' : e.message } } }
      if (session.number !== ownerNumber) return { status: 400, body: { error: `This Session ID belongs to a different WhatsApp number (ends in ${session.number.slice(-4)}). Use the number you paired.` } }
      if (mine(user.uid).length >= cfg.maxBotsPerUser) return { status: 403, body: { error: `You can connect up to ${cfg.maxBotsPerUser} bots.` } }
      if (Object.keys(meta.bots).length >= cfg.maxBots) return { status: 503, body: { error: 'Gideon Cloud is full right now. Try again later.' } }
      if (busy.has('num:' + session.number) || takenNumbers().has(session.number)) return { status: 409, body: { error: 'That WhatsApp number is already connected to Gideon.' } }
      busy.add('num:' + session.number)
      const id = 'cb_' + crypto.randomBytes(6).toString('hex')
      try {
        fs.mkdirSync(dirOf(id), { recursive: true, mode: 0o700 })
        fs.writeFileSync(path.join(dirOf(id), 'creds.json'), session.text, { mode: 0o600 })
        meta.bots[id] = { id, uid: user.uid, ownerName, number: session.number, createdAt: Date.now(), autostart: true }
        save()
        await manager.cloud.open(id, dirOf(id))
        log(`[cloud] bot ${id} added`) // no number, no session data in logs
        return { status: 201, body: { ok: true, bot: view(meta.bots[id]) } }
      } catch (err) {
        fs.rmSync(dirOf(id), { recursive: true, force: true })
        delete meta.bots[id]; save()
        return { status: 500, body: { error: 'Could not start this bot. Nothing was saved.' } }
      } finally { busy.delete('num:' + session.number) }
    },

    async get(user, id) {
      const rec = owned(user.uid, id)
      return rec ? { status: 200, body: { bot: view(rec) } } : { status: 404, body: { error: 'Bot not found.' } }
    },

    async action(user, id, action) {
      const rec = owned(user.uid, id)
      if (!rec) return { status: 404, body: { error: 'Bot not found.' } }
      if (busy.has(id)) return { status: 409, body: { error: 'Another action is still running on this bot.' } }
      busy.add(id)
      try {
        const ctl = manager.get(id)
        const running = ctl && ctl.cloud && !ctl.stopped
        if (action === 'stop') { await manager.cloud.stop(id); rec.autostart = false }
        else if (action === 'start') { if (!running) await manager.cloud.open(id, dirOf(id)); rec.autostart = true }
        else if (action === 'restart') { await manager.cloud.open(id, dirOf(id)); rec.autostart = true }
        else return { status: 400, body: { error: 'Unknown action.' } }
        save()
        return { status: 200, body: { ok: true, bot: view(rec) } }
      } catch { return { status: 500, body: { error: 'That action failed.' } } }
      finally { busy.delete(id) }
    },

    async remove(user, id) {
      const rec = owned(user.uid, id)
      if (!rec) return { status: 404, body: { error: 'Bot not found.' } }
      if (busy.has(id)) return { status: 409, body: { error: 'Another action is still running on this bot.' } }
      busy.add(id)
      try {
        await manager.cloud.close(id).catch(() => {})
        fs.rmSync(dirOf(id), { recursive: true, force: true })
        delete meta.bots[id]; save()
        return { status: 200, body: { ok: true } }
      } finally { busy.delete(id) }
    },

    async logs(user, id) {
      const rec = owned(user.uid, id)
      if (!rec) return { status: 404, body: { error: 'Bot not found.' } }
      const ctl = manager.get(id)
      return { status: 200, body: { lines: ctl && ctl.cloud ? ctl.logs.slice(-200) : [] } }
    }
  }

  // ---- HTTP
  const SEC = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  }
  const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = []
      req.on('data', (c) => { size += c.length; if (size > 3e6) req.destroy(); else if (size <= 300e3) chunks.push(c) }) // oversize bodies are drained, then refused with 413
      req.on('end', () => {
        if (size > 300e3) return reject(Object.assign(new Error('Request too large.'), { status: 413 }))
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })) }
      })
      req.on('error', reject)
    })
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x')
    const pathname = url.pathname
    const origin = req.headers.origin
    const send = (status, body, extra = {}) => {
      const text = JSON.stringify(body)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...extra })
      res.end(text)
    }
    if (!pathname.startsWith('/api/cloud/')) {
      const file = req.method === 'GET' || req.method === 'HEAD' ? STATIC[pathname] : null
      if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SEC }); return res.end('Not found') }
      try {
        const data = fs.readFileSync(path.join(ROOT, file[0]))
        res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache', ...SEC })
        return res.end(req.method === 'HEAD' ? undefined : data)
      } catch { res.writeHead(404, { 'Content-Type': 'text/plain', ...SEC }); return res.end('Not found') }
    }
    const cors = origin && (cfg.allowedOrigins || []).includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', Vary: 'Origin' } : {}
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, ...SEC }); return res.end() }
    const reply = (status, body) => send(status, body, cors)

    if (limited('ip:' + ip(req), 300, 60e3)) return reply(429, { error: 'Too many requests.' })
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
    let user
    try { user = await verify(token) } catch {
      if (limited('authfail:' + ip(req), 30, 10 * 60e3)) return reply(429, { error: 'Too many failed sign-ins.' })
      return reply(401, { error: 'Sign in required.' })
    }
    if (cfg.requireVerifiedEmail && !user.emailVerified) return reply(403, { error: 'Verify your email address to use Gideon Cloud.', code: 'EMAIL_UNVERIFIED' })
    if (limited('uid:' + user.uid, 120, 60e3)) return reply(429, { error: 'Too many requests.' })

    try {
      const p = pathname.replace('/api/cloud', '').replace(/\/+$/, '') || '/'
      let m, out
      if (p === '/capabilities' && req.method === 'GET') out = await H.capabilities(user)
      else if (p === '/bots' && req.method === 'GET') out = await H.list(user)
      else if (p === '/bots' && req.method === 'POST') out = await H.connect(user, await readJson(req))
      else if ((m = /^\/bots\/([^/]+)$/.exec(p)) && req.method === 'GET') out = await H.get(user, m[1])
      else if (m && req.method === 'DELETE') out = await H.remove(user, m[1])
      else if ((m = /^\/bots\/([^/]+)\/(start|stop|restart)$/.exec(p)) && req.method === 'POST') out = await H.action(user, m[1], m[2])
      else if ((m = /^\/bots\/([^/]+)\/logs$/.exec(p)) && req.method === 'GET') out = await H.logs(user, m[1])
      else out = { status: 404, body: { error: 'Not found.' } }
      return reply(out.status, out.body)
    } catch (err) {
      if (err.status) return reply(err.status, { error: err.message })
      console.error('[cloud] request failed:', err.message)
      return reply(500, { error: 'Something went wrong.' })
    }
  }

  const server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end() } catch {} }) })

  // bring back every bot that was running before a restart / update, staggered like paired users
  function restore() {
    let delay = 6000
    for (const rec of Object.values(meta.bots)) {
      if (!rec.autostart || !fs.existsSync(path.join(dirOf(rec.id), 'creds.json'))) continue
      setTimeout(() => manager.cloud.open(rec.id, dirOf(rec.id)).then(() => log(`[cloud] restored ${rec.id}`)).catch(() => {}), delay)
      delay += 2500
    }
  }
  return { server, handle, restore, meta: () => meta }
}

function start(manager) {
  if (!config.cloud?.enabled) return null
  const port = Number(process.env.PORT) || config.cloud.port || 3000
  const svc = createCloud({ manager, dataDir: path.join(ROOT, 'cloud-data') })
  svc.server.on('error', (err) => console.error(`[cloud] could not listen on port ${port}: ${err.message}`))
  svc.server.listen(port, () => console.log(`[cloud] GIDEON CLOUD dashboard on port ${port}`))
  svc.restore()
  return svc
}

module.exports = { start, createCloud, decodeSession, verifyFirebaseToken }
