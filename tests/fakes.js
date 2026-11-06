// Minimal in-memory stand-ins so the platform layer can be tested without Firebase or Express.
// Only the subset of the API the platform code uses is implemented.
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
class DocSnap { constructor(ref, data) { this.ref = ref; this.id = ref.id; this._d = data } get exists() { return this._d !== undefined } data() { return clone(this._d) } }
class DocRef {
  constructor(db, col, id) { this.db = db; this.col = col; this.id = id; this.firestore = db }
  async get() { return new DocSnap(this, this.db.data[this.col]?.[this.id]) }
  async set(d) { (this.db.data[this.col] = this.db.data[this.col] || {})[this.id] = clone(d) }
  async update(p) { const cur = this.db.data[this.col]?.[this.id]; if (cur === undefined) throw new Error('NOT_FOUND'); Object.assign(cur, clone(p)) }
  async delete() { delete this.db.data[this.col]?.[this.id] }
}
class Query {
  constructor(db, col, f = [], o = null, l = null) { this.db = db; this.col = col; this.f = f; this.o = o; this.l = l }
  where(k, op, v) { return new Query(this.db, this.col, [...this.f, [k, op, v]], this.o, this.l) }
  orderBy(k, dir = 'asc') { return new Query(this.db, this.col, this.f, [k, dir], this.l) }
  limit(n) { return new Query(this.db, this.col, this.f, this.o, n) }
  async get() {
    let rows = Object.entries(this.db.data[this.col] || {}).map(([id, d]) => [id, d])
    for (const [k, op, v] of this.f) rows = rows.filter(([, d]) => (op === '==' ? d[k] === v : op === '<' ? d[k] < v : op === '>' ? d[k] > v : false))
    if (this.o) rows.sort((a, b) => ((a[1][this.o[0]] > b[1][this.o[0]] ? 1 : -1) * (this.o[1] === 'desc' ? -1 : 1)))
    if (this.l) rows = rows.slice(0, this.l)
    const docs = rows.map(([id, d]) => new DocSnap(new DocRef(this.db, this.col, id), d))
    return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn) }
  }
}
class Col extends Query {
  constructor(db, col) { super(db, col) }
  doc(id) { return new DocRef(this.db, this.col, id || 'auto_' + Math.random().toString(36).slice(2)) }
  async add(d) { const r = this.doc(); await r.set(d); return r }
}
class FakeDb {
  constructor() { this.data = {} }
  collection(n) { return new Col(this, n) }
  async runTransaction(fn) {
    // serialize transactions like Firestore would effectively do under contention
    const prev = this._lock || Promise.resolve()
    let release; this._lock = new Promise((r) => (release = r))
    await prev
    try {
      const writes = []
      const tx = {
        get: async (ref) => (ref.get ? ref.get() : ref.get()),
        set: (ref, d) => writes.push(() => ref.set(d)),
        update: (ref, p) => writes.push(() => ref.update(p)),
        delete: (ref) => writes.push(() => ref.delete())
      }
      const out = await fn(tx)
      for (const w of writes) await w()
      return out
    } finally { release() }
  }
}
// tiny express-like app: just enough for app.get/post/put/delete/use, req.body/params/query/get, res.json/status/set/sendFile/end
function makeApp() {
  const routes = []; const mids = []
  const reg = (m) => (p, ...h) => routes.push({ m, p, h })
  const app = { get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE'), use: (...a) => mids.push(typeof a[0] === 'string' ? { prefix: a[0], fn: a[1] } : { prefix: '', fn: a[0] }), set() {}, disable() {} }
  const match = (p, path) => { const keys = []; const re = new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'); const m = path.match(re); return m ? Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) : null }
  app.request = async (method, url, { body, headers = {}, raw, ip = '1.1.1.1' } = {}) => {
    const [path, qs] = url.split('?')
    const query = Object.fromEntries(new URLSearchParams(qs || ''))
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    const req = { method, path, body: body ? JSON.parse(JSON.stringify(body)) : {}, query, ip, rawBody: raw !== undefined ? Buffer.from(raw) : body ? Buffer.from(JSON.stringify(body)) : undefined, params: {}, get: (k) => h[k.toLowerCase()] }
    let status = 200, out, done
    const finished = new Promise((r) => (done = r))
    const res = { statusCode: 200, status(c) { status = c; this.statusCode = c; return this }, json(b) { out = b; done(); return this }, set() { return this }, end() { done(); return this }, sendFile() { out = 'FILE'; done() } }
    const chain = []
    for (const mw of mids) if (req.path.startsWith(mw.prefix)) chain.push((q, s, n) => { const o = q.path; if (mw.prefix) q.path = o.slice(mw.prefix.length) || '/'; mw.fn(q, s, () => { q.path = o; n() }) })
    const route = routes.find((r) => r.m === method && match(r.p, path))
    if (!route) return { status: 404, body: { error: 'no route' } }
    req.params = match(route.p, path)
    const handlers = [...chain, ...route.h]
    let i = 0
    const next = () => { const f = handlers[i++]; if (f) Promise.resolve(f(req, res, next)).catch((e) => { status = 500; out = { error: e.message }; done() }) }
    next()
    await finished
    return { status: res.statusCode !== 200 ? res.statusCode : status, body: out }
  }
  return app
}
module.exports = { FakeDb, makeApp }
