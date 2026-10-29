const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const config = require('./config')
const store = require('./store')

const root = __dirname
const SKIP = [/^session\//, /^sessions\//, /^node_modules\//, /^\.git\//, /^database\.json$/, /^config\.local\.json$/, /^\.env$/]
const headers = { 'User-Agent': 'gideon-bot', Accept: 'application/vnd.github+json' }

async function latest() {
  const axios = require('axios')
  const res = await axios.get(`https://api.github.com/repos/${config.repo}/commits/${config.repoBranch}`, { headers, timeout: 15000 })
  const c = res.data
  return { sha: c.sha, message: String(c.commit?.message || '').split('\n')[0], date: c.commit?.committer?.date }
}

function runNpm() {
  return new Promise((resolve, reject) => {
    execFile('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: root, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).slice(-300)))
      else resolve()
    })
  })
}

// Downloads the repo zip and copies it over this folder.
// Never touches: session/, sessions/, database.json, config.local.json, node_modules/.
async function apply() {
  const axios = require('axios')
  const AdmZip = require('adm-zip')
  const url = `https://codeload.github.com/${config.repo}/zip/refs/heads/${config.repoBranch}`
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 90000, headers: { 'User-Agent': 'gideon-bot' }, maxContentLength: 100 * 1024 * 1024 })
  const zip = new AdmZip(Buffer.from(res.data))
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  if (!entries.length) throw new Error('Downloaded zip is empty')
  const top = entries[0].entryName.split('/')[0] + '/'

  let oldDeps = ''
  try {
    oldDeps = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies)
  } catch {}

  let changed = 0
  for (const entry of entries) {
    const rel = entry.entryName.startsWith(top) ? entry.entryName.slice(top.length) : entry.entryName
    if (!rel || SKIP.some((re) => re.test(rel))) continue
    const target = path.resolve(root, rel)
    if (!target.startsWith(root + path.sep)) continue // path traversal guard
    const data = entry.getData()
    if (fs.existsSync(target) && fs.readFileSync(target).equals(data)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
    changed += 1
  }

  let newDeps = ''
  try {
    newDeps = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies)
  } catch {}
  const depsChanged = oldDeps !== newDeps
  if (depsChanged) await runNpm()
  return { changed, depsChanged }
}

// DM the owner once when GitHub has something newer
async function notify(manager) {
  if (!config.updateNotify) return
  try {
    const info = await latest()
    const db = store.get()
    if (info.sha === db.updateSha || info.sha === db.updateNotified) return
    const bot = manager.get('main')
    if (!bot?.sock?.user) return
    await bot.sock.sendMessage(bot.sock.getOwnerJid(), {
      text: `Update available on GitHub\n${info.message}\n\nSend ${config.prefix}update to install it.`
    })
    db.updateNotified = info.sha
    store.save()
  } catch (err) {
    console.log('[update] check failed:', err.message)
  }
}

module.exports = { latest, apply, notify }
