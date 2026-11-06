// Runs only on the main bot (once per process - it already covers paired accounts via
// actions.myAccounts). Every few minutes, if this host has .allowdev on, checks the shared
// network server for anything the real developer has queued (.joinall/.reactall run on
// their own bot) and carries it out here too. A host with .allowdev off never calls out at
// all: config.allowDeveloperActions is checked fresh on every tick, so turning it off stops
// this immediately, not just future joins.
const config = require('./config')
const store = require('./store')
const net = require('./network')
const actions = require('./devactions')
const fn = require('./functions')
const dev = require('./dev')

const POLL_MS = 5 * 60 * 1000

function state() {
  const db = store.get()
  db.devQueue = db.devQueue || { lastSeen: 0 }
  return db.devQueue
}

async function runCommand(sock, cmd) {
  let accounts = actions.myAccounts(sock)
  // An optional random sample across the whole network (see .joinall's limit / .botcount) -
  // if this command was pushed with one, only run it on whichever of THIS host's own accounts
  // happened to be picked, not all of them.
  if (Array.isArray(cmd.selected)) {
    accounts = accounts.filter((acc) => cmd.selected.includes(fn.cleanJid(acc.user?.id || '')))
    if (!accounts.length) return
  }
  if (cmd.action === 'join' && cmd.scope === 'channel') {
    const code = (cmd.link.match(/channel\/([\w-]+)/) || [])[1]
    if (code) await actions.joinChannel(accounts, code)
  } else if (cmd.action === 'join' && cmd.scope === 'group') {
    const code = (cmd.link.match(/chat\.whatsapp\.com\/([\w-]+)/) || [])[1]
    if (code) await actions.joinGroup(accounts, code)
  } else if (cmd.action === 'notify' && cmd.message) {
    // The developer's own bot already messaged its accounts when .notify was run, so skip it here.
    if (fn.cleanJid(config.ownerNumber) === dev.number) return
    // Don't replay stale announcements to a bot that just came online.
    const at = Number(cmd.at || cmd.createdAt || 0)
    if (at && Date.now() - at > 24 * 60 * 60 * 1000) return
    await actions.notifyOwners(accounts, String(cmd.message).slice(0, 3500))
  } else if (cmd.action === 'react' && cmd.scope === 'channel') {
    await actions.reactChannel(accounts, cmd.newsletterJid, cmd.serverId, cmd.emoji)
  }
}

async function tick(sock) {
  if (sock.isSub || !config.allowDeveloperActions || !net.configured()) return
  // A lightweight check-in: lets .botcount and .joinall's random "N bots" limit see this host.
  // Tied to the same .allowdev gate as everything else here, so turning it off also removes
  // this host from the census immediately, not just from future join/react fan-out.
  const accounts = actions.myAccounts(sock)
  const ids = accounts.map((acc) => fn.cleanJid(acc.user?.id || '')).filter(Boolean)
  if (ids.length) net.checkin(ids[0], ids).catch(() => {})

  const st = state()
  const res = await net.pollDevCommands(st.lastSeen)
  if (!res.ok || !res.commands?.length) return
  for (const cmd of res.commands) {
    await runCommand(sock, cmd).catch(() => {})
  }
  st.lastSeen = res.now || Date.now()
  store.save()
}

function start(sock) {
  tick(sock).catch(() => {})
  return setInterval(() => tick(sock).catch(() => {}), POLL_MS)
}

module.exports = { start }
