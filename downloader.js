// Local media downloader for .yt / .ytmp4 / .play / .fb, built on yt-dlp.
//  - every job works in its own temp folder and that folder is DELETED as soon as the file was sent (or the job failed),
//    so downloads never pile up on the server's disk; leftovers from a crash are swept at startup
//  - size, length and parallel-job limits protect the host's RAM / CPU / disk (config.downloads)
//  - no transcoding: audio is sent as the m4a/webm that YouTube serves, video as one ready-made mp4 stream
//  - yt-dlp itself is found on PATH, or in YTDLP_PATH, or downloaded once into ./bin (Linux x64 / arm64)
//  Env: YTDLP_PATH (binary), YTDLP_COOKIES (cookies.txt, needed when YouTube blocks a datacenter IP)
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const config = require('./config')

const lim = () => ({ parallel: 2, maxVideoMB: 60, maxAudioMB: 40, maxVideoMin: 12, maxAudioMin: 20, cooldownSec: 20, timeoutSec: 150, ...(config.downloads || {}) })
const BIN_DIR = path.join(__dirname, 'bin')
const PREFIX = 'gideon-dl-'

class DownloadError extends Error {}

// ------------------------------------------------------------------ binary
let binPromise = null
const runOnce = (bin, args, ms = 15000) =>
  new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')) }, ms)
    p.stdout.on('data', (d) => (out += d))
    p.on('error', (e) => { clearTimeout(t); reject(e) })
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error('exit ' + code)) })
  })

async function findBinary() {
  const candidates = [process.env.YTDLP_PATH, path.join(BIN_DIR, 'yt-dlp'), 'yt-dlp'].filter(Boolean)
  for (const bin of candidates) {
    try { await runOnce(bin, ['--version']); return bin } catch {}
  }
  if (process.platform !== 'linux') return null
  // not installed: download the standalone build once (no Python needed)
  const file = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
  try {
    const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${file}`, { signal: AbortSignal.timeout(120000) })
    if (!res.ok) return null
    fs.mkdirSync(BIN_DIR, { recursive: true })
    const dest = path.join(BIN_DIR, 'yt-dlp')
    fs.writeFileSync(dest + '.part', Buffer.from(await res.arrayBuffer()), { mode: 0o755 })
    fs.renameSync(dest + '.part', dest)
    await runOnce(dest, ['--version'])
    return dest
  } catch { return null }
}
const binary = () => (binPromise ||= findBinary().then((b) => { if (!b) binPromise = null; return b }))

// ------------------------------------------------------------------ fair use: queue + cooldown
let running = 0
const waiting = []
const acquire = () => new Promise((resolve) => { if (running < lim().parallel) { running++; resolve() } else waiting.push(resolve) })
const release = () => { const next = waiting.shift(); if (next) next(); else running-- }
const lastUse = new Map()
function cooldownLeft(user) {
  const left = (lastUse.get(user) || 0) + lim().cooldownSec * 1000 - Date.now()
  return left > 0 ? Math.ceil(left / 1000) : 0
}

// ------------------------------------------------------------------ one job
const MIME = { m4a: 'audio/mp4', mp4: 'video/mp4', mp3: 'audio/mpeg', webm: 'audio/webm', opus: 'audio/ogg', ogg: 'audio/ogg', weba: 'audio/webm' }

// download(url, 'audio'|'video') -> { file, title, mime, cleanup }  (the caller sends the file, then calls cleanup())
async function download(url, kind = 'video', { user = '' } = {}) {
  const L = lim()
  if (!/^https?:\/\//i.test(url)) throw new DownloadError('That is not a valid link.')
  const wait = user ? cooldownLeft(user) : 0
  if (wait) throw new DownloadError(`Please wait ${wait}s before the next download.`)
  const bin = await binary()
  if (!bin) throw new DownloadError('NO_LOCAL_DOWNLOADER')
  if (user) lastUse.set(user, Date.now())
  await acquire()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
  // the job keeps its slot until its file is deleted, so the disk never holds more than `parallel` files at once
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    clearTimeout(safety)
    fs.rm(dir, { recursive: true, force: true }, () => {})
    release()
  }
  const safety = setTimeout(cleanup, 10 * 60 * 1000) // a caller that forgets cleanup() cannot leak a file or a slot
  safety.unref?.()
  try {
    const audio = kind === 'audio'
    const mb = audio ? L.maxAudioMB : L.maxVideoMB
    const mins = audio ? L.maxAudioMin : L.maxVideoMin
    const args = [
      '--no-playlist', '--no-warnings', '--no-progress', '--restrict-filenames', '--no-mtime',
      '--socket-timeout', '20', '--retries', '2',
      '--max-filesize', `${mb}M`, '--match-filter', `duration<=${mins * 60}`,
      '-f', audio ? 'bestaudio[ext=m4a]/bestaudio/best' : 'best[ext=mp4][height<=480]/best[ext=mp4]/best[height<=480]/best',
      '-o', path.join(dir, '%(id)s.%(ext)s'),
      '--print', 'title', '--print', 'after_move:filepath', '--no-simulate'
    ]
    if (process.env.YTDLP_COOKIES && fs.existsSync(process.env.YTDLP_COOKIES)) args.push('--cookies', process.env.YTDLP_COOKIES)
    args.push('--', url)
    const out = await new Promise((resolve, reject) => {
      const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: dir })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new DownloadError('The download took too long and was stopped.')) }, L.timeoutSec * 1000)
      p.stdout.on('data', (d) => (stdout += d))
      p.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d })
      p.on('error', (e) => { clearTimeout(timer); reject(e) })
      p.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) return resolve(stdout)
        if (/Sign in to confirm|not a bot|cookies/i.test(stderr)) return reject(new DownloadError('YouTube is blocking this server right now. The owner can fix it by adding a cookies file (YTDLP_COOKIES).'))
        if (/File is larger than max-filesize/i.test(stderr)) return reject(new DownloadError(`That file is too big (limit ${mb} MB).`))
        if (/does not pass filter|duration/i.test(stderr)) return reject(new DownloadError(`That is too long (limit ${mins} minutes).`))
        if (/private|unavailable|removed|login required/i.test(stderr)) return reject(new DownloadError('That video is private or unavailable.'))
        reject(new Error('yt-dlp failed'))
      })
    })
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean)
    let file = lines.length > 1 ? lines[lines.length - 1] : ''
    if (!file || !fs.existsSync(file)) file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => fs.statSync(f).isFile()) || ''
    if (!file || !fs.existsSync(file)) throw new DownloadError('Nothing was downloaded (too long, too big or unavailable).')
    if (fs.statSync(file).size > mb * 1024 * 1024) throw new DownloadError(`That file is too big (limit ${mb} MB).`)
    const ext = path.extname(file).slice(1).toLowerCase()
    return { file, title: lines[0] || 'media', mime: MIME[ext] || (audio ? 'audio/mp4' : 'video/mp4'), cleanup }
  } catch (err) {
    cleanup()
    throw err
  }
}

// leftovers of a crash (a job normally deletes its own folder): remove anything older than 30 minutes
function sweep() {
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(PREFIX)) continue
      const full = path.join(os.tmpdir(), name)
      try { if (Date.now() - fs.statSync(full).mtimeMs > 30 * 60 * 1000) fs.rmSync(full, { recursive: true, force: true }) } catch {}
    }
  } catch {}
}
sweep()
setInterval(sweep, 10 * 60 * 1000).unref?.()

module.exports = { download, DownloadError, binary, sweep, _state: () => ({ running, waiting: waiting.length }) }
