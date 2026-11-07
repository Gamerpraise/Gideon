// Gideon Cloud storage in Firebase (Firestore). Each Cloud user's session + settings are kept, ENCRYPTED, in Firestore:
//   cloudBots/{botId}                 the bot record (owner uid, number, ...), chunk count, fingerprint, update time
//   cloudBots/{botId}/chunks/{n}      the encrypted data, split in pieces under Firestore's 1 MiB limit
// The files on disk stay the working copy (WhatsApp needs them); this copy is what survives a wiped disk or a move to
// another host, and it is DELETED the moment the user logs out of WhatsApp or deletes their bot.
// Plain REST + a signed service-account token: no extra npm package.
// Env: FIREBASE_SERVICE_ACCOUNT  the service-account JSON (or the same JSON base64-encoded)
//      CLOUD_STORE_KEY           optional passphrase for the encryption (default: derived from the service account key)
const crypto = require('crypto')

const SCOPE = 'https://www.googleapis.com/auth/datastore'
const CHUNK = 600000 // characters of base64 per document

function loadServiceAccount(raw) {
  if (!raw) return null
  let text = String(raw).trim()
  if (!text.startsWith('{')) { try { text = Buffer.from(text, 'base64').toString('utf8') } catch { return null } }
  try {
    const sa = JSON.parse(text)
    return sa.client_email && sa.private_key && sa.project_id ? sa : null
  } catch { return null }
}

function createStore({ serviceAccount, passphrase, fetchImpl = (...a) => fetch(...a), collection = 'cloudBots', now = () => Date.now() }) {
  const sa = serviceAccount
  const key = crypto.createHash('sha256').update(String(passphrase || sa.private_key)).digest()
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/databases/(default)/documents`
  let tok = null

  async function token() {
    if (tok && tok.exp > now() + 60000) return tok.value
    const iat = Math.floor(now() / 1000)
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const unsigned = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })}`
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }).toString(),
      signal: AbortSignal.timeout(20000)
    })
    if (!res.ok) throw new Error('Firebase sign-in failed (' + res.status + ')')
    const j = await res.json()
    tok = { value: j.access_token, exp: now() + (j.expires_in || 3600) * 1000 }
    return tok.value
  }

  async function api(method, path, body) {
    const res = await fetchImpl(`${base}/${path}`, {
      method,
      headers: { authorization: 'Bearer ' + (await token()), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    })
    if (res.status === 404 && method !== 'PATCH') return null
    if (!res.ok) throw new Error(`Firestore ${method} ${path.split('?')[0]} failed (${res.status})`)
    return method === 'DELETE' ? {} : res.json()
  }

  const str = (v) => ({ stringValue: String(v) })
  const int = (v) => ({ integerValue: String(v) })
  const val = (f, k) => (f && f[k] ? f[k].stringValue ?? f[k].integerValue : undefined)

  // files: { name: Buffer }  ->  encrypted base64 text
  function seal(files) {
    const plain = require('zlib').gzipSync(JSON.stringify(Object.fromEntries(Object.entries(files).map(([n, buf]) => [n, Buffer.from(buf).toString('base64')]))))
    const iv = crypto.randomBytes(12)
    const c = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([c.update(plain), c.final()])
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
  }
  function open(text) {
    const raw = Buffer.from(text, 'base64')
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    const plain = require('zlib').gunzipSync(Buffer.concat([d.update(raw.subarray(28)), d.final()]))
    return Object.fromEntries(Object.entries(JSON.parse(plain.toString('utf8'))).map(([n, b]) => [n, Buffer.from(b, 'base64')]))
  }
  const fingerprint = (files) => {
    const h = crypto.createHash('sha256')
    for (const n of Object.keys(files).sort()) h.update(n).update('\0').update(files[n]).update('\0')
    return h.digest('hex')
  }

  const known = new Map() // botId -> { sha, chunks }: what is already in Firestore (skips identical uploads)

  async function put(id, rec, files) {
    const sha = fingerprint(files)
    const prev = known.get(id)
    if (prev && prev.sha === sha) return false
    const text = seal(files)
    const chunks = Math.max(1, Math.ceil(text.length / CHUNK))
    for (let i = 0; i < chunks; i++) await api('PATCH', `${collection}/${id}/chunks/${i}`, { fields: { d: str(text.slice(i * CHUNK, (i + 1) * CHUNK)) } })
    await api('PATCH', `${collection}/${id}`, { fields: { rec: str(JSON.stringify(rec)), chunks: int(chunks), sha: str(sha), updatedAt: int(now()) } })
    for (let i = chunks; prev && i < prev.chunks; i++) await api('DELETE', `${collection}/${id}/chunks/${i}`).catch(() => {}) // the new copy is smaller
    known.set(id, { sha, chunks })
    return true
  }

  async function get(id) {
    const doc = await api('GET', `${collection}/${id}`)
    if (!doc) return null
    const n = Number(val(doc.fields, 'chunks') || 0)
    let text = ''
    for (let i = 0; i < n; i++) {
      const c = await api('GET', `${collection}/${id}/chunks/${i}`)
      if (!c) throw new Error('backup is incomplete')
      text += val(c.fields, 'd')
    }
    return { rec: JSON.parse(val(doc.fields, 'rec') || '{}'), files: open(text), updatedAt: Number(val(doc.fields, 'updatedAt') || 0) }
  }

  async function list() {
    const out = []
    let page = ''
    do {
      const r = await api('GET', `${collection}?pageSize=100&mask.fieldPaths=chunks${page ? '&pageToken=' + encodeURIComponent(page) : ''}`)
      for (const d of r?.documents || []) out.push({ id: d.name.split('/').pop(), chunks: Number(val(d.fields, 'chunks') || 0) })
      page = r?.nextPageToken || ''
    } while (page)
    return out
  }

  // the user logged out / deleted the bot: nothing of theirs may stay in Firebase
  async function remove(id) {
    const doc = await api('GET', `${collection}/${id}`)
    const n = Math.max(Number(val(doc?.fields, 'chunks') || 0), known.get(id)?.chunks || 0)
    for (let i = 0; i < n; i++) await api('DELETE', `${collection}/${id}/chunks/${i}`)
    if (doc) await api('DELETE', `${collection}/${id}`)
    known.delete(id)
  }

  return { put, get, list, remove, _seal: seal, _open: open }
}

// the store configured by the environment, or null (Cloud then keeps everything on the disk only, as before)
function fromEnv(env = process.env) {
  const sa = loadServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)
  return sa ? createStore({ serviceAccount: sa, passphrase: env.CLOUD_STORE_KEY }) : null
}

module.exports = { createStore, fromEnv, loadServiceAccount }
