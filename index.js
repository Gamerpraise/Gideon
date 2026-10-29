// Start file for Katabump / any host:  node index.js
// It runs main.js and brings it back automatically after .restart, .update or a crash.
const { spawn, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const RESTART_CODE = 42
let child = null
let stopping = false
let crashes = 0

if (!fs.existsSync(path.join(__dirname, 'node_modules', '@whiskeysockets'))) {
  console.log('[Gideon] installing dependencies (first start)...')
  try {
    execSync('npm install --omit=dev --no-audit --no-fund', { cwd: __dirname, stdio: 'inherit' })
  } catch (err) {
    console.error('[Gideon] npm install failed:', err.message)
  }
}

function run() {
  const startedAt = Date.now()
  child = spawn(process.execPath, [path.join(__dirname, 'main.js')], { stdio: 'inherit', cwd: __dirname })
  child.on('exit', (code, signal) => {
    if (stopping) return process.exit(0)
    if (code === RESTART_CODE) {
      crashes = 0
      console.log('[Gideon] restarting...')
      return setTimeout(run, 500)
    }
    crashes = Date.now() - startedAt < 15000 ? crashes + 1 : 0
    const wait = Math.min(3000 * (crashes + 1), 60000)
    console.log(`[Gideon] stopped (code ${code}${signal ? ', ' + signal : ''}), starting again in ${Math.round(wait / 1000)}s`)
    setTimeout(run, wait)
  })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true
    if (child) child.kill(sig)
    else process.exit(0)
    setTimeout(() => process.exit(0), 5000)
  })
}

run()
