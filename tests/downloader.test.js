// The local downloader: temp files are deleted after sending, limits hold, .yt downloads. Uses a fake yt-dlp. No network.
const ROOT = require('path').join(__dirname, '..'); process.chdir(ROOT)
require(require('path').join(ROOT, 'tests/stub-missing-modules.js'))
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert')
const fake = path.join(os.tmpdir(), 'fake-ytdlp-test.sh'), log = path.join(os.tmpdir(), 'fake-ytdlp-test.log')
fs.writeFileSync(fake, `#!/bin/bash
echo "$@" >> ${log}
if [ "$1" = "--version" ]; then echo 2099.01.01; exit 0; fi
case "$*" in *private-video*) echo "ERROR: Video unavailable. This video is private" >&2; exit 1;; *blocked-video*) echo "Sign in to confirm you're not a bot" >&2; exit 1;; esac
OUT=""; PREV=""; for a in "$@"; do if [ "$PREV" = "-o" ]; then OUT="$a"; fi; PREV="$a"; done
F="\${OUT//%(id)s/abc}"; F="\${F//%(ext)s/mp4}"
case "$*" in *bestaudio*) F="\${F%.mp4}.m4a";; esac
sleep 0.\${FAKE_DELAY:-05}; head -c 2048 /dev/zero > "$F"
echo "Some Title"; echo "$F"
`, { mode: 0o755 })
process.env.YTDLP_PATH = fake
const config = require(path.join(ROOT, 'config')); config.downloads = { parallel: 2, maxVideoMB: 60, maxAudioMB: 40, maxVideoMin: 12, maxAudioMin: 20, cooldownSec: 20, timeoutSec: 20 }
const dl = require(path.join(ROOT, 'downloader'))
const leftovers = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('gideon-dl-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  // video: limits are passed to yt-dlp, the file is real, cleanup deletes it
  let j = await dl.download('https://fb.watch/xyz', 'video', { user: 'u1' })
  assert(fs.existsSync(j.file) && j.title === 'Some Title' && j.mime === 'video/mp4')
  const args = fs.readFileSync(log, 'utf8')
  assert(args.includes('--max-filesize 60M') && args.includes('duration<=720') && args.includes('best[ext=mp4]') && args.includes('--no-playlist'), args)
  const dir = path.dirname(j.file); j.cleanup(); await sleep(100); assert(!fs.existsSync(dir), 'temp folder deleted after sending')
  // audio: m4a, no transcoding, own limits
  j = await dl.download('https://youtu.be/abc', 'audio', { user: 'u2' }); assert(j.file.endsWith('.m4a') && j.mime === 'audio/mp4'); assert(fs.readFileSync(log, 'utf8').includes('--max-filesize 40M')); j.cleanup()
  // cooldown per person
  await assert.rejects(dl.download('https://youtu.be/abc', 'audio', { user: 'u2' }), /wait \d+s/)
  // friendly errors, and nothing left behind
  await assert.rejects(dl.download('https://youtu.be/private-video', 'video', { user: 'u3' }), /private or unavailable/)
  await assert.rejects(dl.download('https://youtu.be/blocked-video', 'video', { user: 'u4' }), /blocking this server/)
  await assert.rejects(dl.download('not a link', 'video', { user: 'u5' }), /valid link/)
  await sleep(100); assert.deepStrictEqual(leftovers(), [], 'failed jobs leave no files')
  // at most `parallel` jobs hold a slot (until their file is deleted)
  process.env.FAKE_DELAY = '1'
  const a = dl.download('https://youtu.be/1', 'video', { user: 'p1' }), b = dl.download('https://youtu.be/2', 'video', { user: 'p2' }); let third = null
  const c = dl.download('https://youtu.be/3', 'video', { user: 'p3' }).then((x) => (third = x))
  const [ja, jb] = await Promise.all([a, b]); await sleep(1500); assert.strictEqual(third, null, 'third job waits for a free slot'); assert.strictEqual(dl._state().waiting, 1)
  ja.cleanup(); await c; assert(third && fs.existsSync(third.file)); assert.strictEqual(leftovers().length, 2)
  jb.cleanup(); third.cleanup(); await sleep(150); assert.deepStrictEqual(leftovers(), [], 'every file deleted after sending'); assert.strictEqual(dl._state().running, 0)
  // stale leftovers of a crash are swept
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'gideon-dl-')); fs.utimesSync(old, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3)); dl.sweep(); assert(!fs.existsSync(old))

  // the commands: .yt is the video downloader, .fb sends the file then deletes it, no binary = old online route
  const cmds = []; for (const f of fs.readdirSync(path.join(ROOT, 'commands'))) if (f.endsWith('.js')) cmds.push(...[].concat(require(path.join(ROOT, 'commands', f))))
  assert.deepStrictEqual(cmds.filter((c) => c.name === 'ytmp4' || (c.aliases || []).includes('yt')).map((c) => c.name), ['ytmp4'], '.yt belongs to the downloader only')
  assert.strictEqual(cmds.find((c) => c.name === 'ytmp4').aliases.includes('yt'), true)
  const fb = cmds.find((c) => c.name === 'fb'); const sent = []
  const sock = { sendMessage: async (chat, msg) => { sent.push({ msg, existed: fs.existsSync(msg.video.url) }) } }
  const m = { sender: 'cmd1', chat: 'c', key: {}, message: {}, reply: async () => {} }
  await fb.run(sock, m, { text: 'https://fb.watch/xyz' }); await sleep(150)
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].existed, true, 'file existed while sending'); assert(!fs.existsSync(sent[0].msg.video.url), 'and is gone right after'); assert.deepStrictEqual(leftovers(), [])
  fs.rmSync(fake); fs.rmSync(log, { force: true })
  console.log('downloader OK'); process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
