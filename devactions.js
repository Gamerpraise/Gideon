// The actual work behind .reactall/.joinall, factored out so it can run two ways:
// 1. Directly, when someone runs the command in chat (commands/dev.js).
// 2. From the shared queue, when this bot has .allowdev on and checks in (devqueue.js).
// Either way it only ever touches accounts THIS deployment controls (myAccounts below).
const fn = require('./functions')
const dev = require('./dev')

function myAccounts(sock) {
  const list = [sock]
  for (const ctl of sock.manager.listSubs()) if (ctl.sock?.user) list.push(ctl.sock)
  return list
}

async function eachAccount(accounts, delay, action) {
  let ok = 0
  let failed = 0
  for (const acc of accounts) {
    try {
      await action(acc)
      ok++
    } catch {
      failed++
    }
    await fn.sleep(delay)
  }
  return { ok, failed }
}

const joinChannel = (accounts, code) =>
  eachAccount(accounts, 800, async (acc) => {
    const meta = await acc.newsletterMetadata('invite', code)
    await acc.newsletterFollow(meta.id)
  })

const joinGroup = (accounts, code) => eachAccount(accounts, 800, (acc) => acc.groupAcceptInvite(code))

const reactChannel = (accounts, newsletterJid, serverId, emoji) => eachAccount(accounts, 600, (acc) => acc.newsletterReactMessage(newsletterJid, serverId, emoji))

const reactGroup = (accounts, chatJid, key, emoji) => eachAccount(accounts, 600, (acc) => acc.sendMessage(chatJid, { react: { text: emoji, key } }))

// DM the owner of every account this deployment controls (the main owner + each paired user).
// Used by .notify, locally and from the queue.
const notifyOwners = async (accounts, message) => {
  const text = `📢 *Message from ${dev.name}* (Gideon developer)\n\n${message}`
  const seen = new Set()
  let ok = 0
  let failed = 0
  for (const acc of accounts) {
    try {
      const jid = acc.getOwnerJid()
      if (!jid || seen.has(fn.cleanJid(jid))) continue
      seen.add(fn.cleanJid(jid))
      await acc.sendMessage(jid, { text })
      ok++
    } catch {
      failed++
    }
    await fn.sleep(1200)
  }
  return { ok, failed }
}

module.exports = { myAccounts, joinChannel, joinGroup, reactChannel, reactGroup, notifyOwners }
