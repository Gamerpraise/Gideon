// Server health + disk cleaning (Katabump free plan has a small disk, so we watch it).
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const config = require('./config')

const root = __dirname
const MB = 1024 * 1024
const mb = (bytes) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`

// async on purpose: a sync walk over node_modules would freeze the bot while it runs
async function walk(dir) {
  let total = 0
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    try {
      if (e.isSymbolicLink()) continue
      total += e.isDirectory() ? await walk(full) : (await fs.promises.stat(full)).size
    } catch {}
  }
  return total
}

// folder size in bytes, using the fast native `du` when it exists
function sizeOf(target) {
  return new Promise((resolve) => {
    if (!fs.existsSync(target)) return resolve(0)
    if (!fs.statSync(target).isDirectory()) return resolve(fs.statSync(target).size)
    execFile('du', ['-sk', target], { timeout: 20000 }, (err, out) => {
      const kb = parseInt(String(out || '').split(/\s+/)[0])
      resolve(!err && kb >= 0 ? kb * 1024 : walk(target))
    })
  })
}

async function diskReport({ parts: withParts = true } = {}) {
  if (!withParts) {
    const total = await sizeOf(root)
    const limit = (config.diskLimitMB || 700) * MB
    return { total, limit, percent: Math.round((total / limit) * 100), parts: {} }
  }
  const parts = {
    'node_modules': await sizeOf(path.join(root, 'node_modules')),
    session: await sizeOf(path.join(root, 'session')),
    'paired sessions': await sizeOf(path.join(root, 'sessions')),
    caches: (await sizeOf(path.join(root, '.npm'))) + (await sizeOf(path.join(os.homedir(), '.npm'))) + (await sizeOf(path.join(root, 'tmp'))),
    database: await sizeOf(path.join(root, 'database.json'))
  }
  const total = await sizeOf(root)
  const limit = (config.diskLimitMB || 700) * MB
  return { total, limit, percent: Math.round((total / limit) * 100), parts }
}

async function removeCounted(target) {
  const size = await sizeOf(target)
  if (!fs.existsSync(target)) return 0
  try {
    fs.rmSync(target, { recursive: true, force: true })
    return size
  } catch {
    return 0
  }
}

// Safe clean: temp files, npm caches, logs, crash dumps. Never touches logins or settings.
async function clearSafe() {
  let freed = 0
  freed += await removeCounted(path.join(root, 'tmp'))
  freed += await removeCounted(path.join(root, '.npm'))
  freed += await removeCounted(path.join(os.homedir(), '.npm'))
  freed += await removeCounted(path.join(root, '_cacache'))
  freed += await removeCounted(path.join(root, '_logs'))
  freed += await removeCounted(path.join(root, 'database.json.tmp'))
  let files = []
  try {
    files = fs.readdirSync(root)
  } catch {}
  for (const f of files) {
    if (/^(tmp-.*|npm-debug\.log.*|.*\.log|core\.\d+|.*\.heapsnapshot|.*\.bak)$/i.test(f)) freed += await removeCounted(path.join(root, f))
  }
  return freed
}

// Deep clean: also deletes old Signal session / sender-key files nobody has used for 30 days.
// WhatsApp simply sets those chats up again on the next message.
async function clearDeep() {
  let freed = await clearSafe()
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000
  const dirs = [path.join(root, 'session')]
  try {
    for (const d of fs.readdirSync(path.join(root, 'sessions'))) dirs.push(path.join(root, 'sessions', d))
  } catch {}
  for (const dir of dirs) {
    let files = []
    try {
      files = fs.readdirSync(dir)
    } catch {}
    for (const f of files) {
      if (!/^(session|sender-key)-.*\.json$/.test(f)) continue
      const full = path.join(dir, f)
      try {
        const st = fs.statSync(full)
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(full)
          freed += st.size
        }
      } catch {}
    }
  }
  return freed
}

function readNum(file) {
  try {
    const v = fs.readFileSync(file, 'utf8').trim()
    return /^\d+$/.test(v) ? Number(v) : null
  } catch {
    return null
  }
}

function memory() {
  const hostTotal = os.totalmem()
  const limit = readNum('/sys/fs/cgroup/memory.max') || readNum('/sys/fs/cgroup/memory/memory.limit_in_bytes')
  const used = readNum('/sys/fs/cgroup/memory.current') || readNum('/sys/fs/cgroup/memory/memory.usage_in_bytes')
  const total = limit && limit < hostTotal ? limit : hostTotal
  return { total, used: used || hostTotal - os.freemem(), bot: process.memoryUsage().rss }
}

// how long a 0ms timer really takes: if this is high the server (or the bot) is overloaded
async function eventLoopLag() {
  let worst = 0
  for (let i = 0; i < 5; i++) {
    const t = Date.now()
    await new Promise((r) => setTimeout(r, 20))
    worst = Math.max(worst, Date.now() - t - 20)
  }
  return worst
}

async function serverInfo(manager) {
  const disk = await diskReport()
  const mem = memory()
  const lag = await eventLoopLag()
  const bots = manager ? manager.list() : []
  return { disk, mem, lag, load: os.loadavg(), cores: os.cpus().length, bots, online: bots.filter((b) => b.sock?.user).length }
}

// runs on a timer: keep the disk below the limit without anyone having to ask
async function guardDisk(notify) {
  if (!config.autoClear) return
  try {
    let disk = await diskReport({ parts: false }) // one cheap check, the full breakdown only when needed
    if (disk.percent < 85) return
    const before = disk.total
    let freed = await clearSafe()
    disk = await diskReport({ parts: false })
    if (disk.percent >= 92) {
      freed += await clearDeep()
      disk = await diskReport({ parts: false })
    }
    const note = `Disk was ${mb(before)} of ${config.diskLimitMB} MB. Cleaned ${mb(Math.max(0, before - disk.total))}, now ${mb(disk.total)} (${disk.percent}%).`
    console.log('[disk]', note)
    if (notify) await notify(disk.percent >= 95 ? `${note}\nStill nearly full. node_modules is ${mb(await sizeOf(path.join(root, 'node_modules')))}. Remove unused paired users or old files.` : note)
  } catch (err) {
    console.log('[disk] guard failed:', err.message)
  }
}

// drop leftover temp files older than 10 minutes
function sweepTmp() {
  const dir = path.join(root, 'tmp')
  try {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f)
      if (Date.now() - fs.statSync(full).mtimeMs > 10 * 60 * 1000) fs.rmSync(full, { force: true, recursive: true })
    }
  } catch {}
}

module.exports = { mb, diskReport, clearSafe, clearDeep, serverInfo, guardDisk, sweepTmp }
