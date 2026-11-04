const fn = require('../functions')

// .savestatus  : swipe a status, reply to it with .savestatus -> it arrives in YOUR DM.
// Nothing is sent in the chat with the person, and your .savestatus message is deleted.
//
// Every post made with .poststatus / .postpairstatus is remembered here (in memory, per account)
// so .delpost can send a real delete to the exact same recipients. Lost on restart.
const posts = new Map() // accountId -> [{ key, statusJidList }]

function remember(accountId, key, statusJidList) {
  if (!posts.has(accountId)) posts.set(accountId, [])
  const list = posts.get(accountId)
  list.push({ key, statusJidList })
  if (list.length > 30) list.shift()
}

async function buildRecipients(account) {
  const list = new Set(account.knownContacts())
  try {
    const groups = await account.groupFetchAllParticipating()
    for (const g of Object.values(groups)) {
      for (const p of g.participants || []) {
        const pn = p.phoneNumber || (String(p.id).endsWith('@s.whatsapp.net') ? p.id : null)
        if (pn) list.add(pn)
      }
    }
  } catch {}
  list.add(account.getOwnerJid())
  return [...list].slice(0, 1000)
}

async function postFrom(account, content) {
  const statusJidList = await buildRecipients(account)
  const sent = await account.sendMessage('status@broadcast', content, { statusJidList, skipStyle: true })
  if (sent?.key) remember(account.botId, sent.key, statusJidList)
  return statusJidList.length
}

async function deleteFrom(account) {
  const list = posts.get(account.botId) || []
  posts.delete(account.botId)
  let done = 0
  for (const p of list) {
    try {
      await account.sendMessage('status@broadcast', { delete: p.key }, { statusJidList: p.statusJidList })
      done++
    } catch {}
    await fn.sleep(400)
  }
  return { done, total: list.length }
}

function buildContent(source, text, prefix) {
  const kind = (source.mtype || '').replace('Message', '')
  if (['image', 'video', 'audio'].includes(kind)) return null // caller downloads async, handled below
  const body = text || source.quoted?.text
  if (!body) return { error: `Example: ${prefix}poststatus Good morning everyone\nor reply to an image/video with ${prefix}poststatus caption` }
  return { content: { text: body, backgroundColor: '#1a1a2e', font: 1 } }
}

async function resolveContent(m, text) {
  const source = m.quoted || m
  const kind = (source.mtype || '').replace('Message', '')
  if (['image', 'video', 'audio'].includes(kind)) {
    const buffer = await source.download()
    if (kind === 'image') return { image: buffer, caption: text }
    if (kind === 'video') return { video: buffer, caption: text }
    return { audio: buffer, mimetype: 'audio/mp4', ptt: true }
  }
  const body = text || m.quoted?.text
  if (!body) return null
  return { text: body, backgroundColor: '#1a1a2e', font: 1 }
}

module.exports = [
  {
    name: 'savestatus',
    aliases: ['getstatus', 'statusdl', 'sstatus'],
    desc: 'Reply to a status to save it to your DM',
    category: 'media',
    owner: true,
    subSafe: true,
    async run(sock, m) {
      const dm = sock.getOwnerJid()
      const quiet = async () => {
        try {
          await sock.sendMessage(m.chat, { delete: m.key })
        } catch {}
      }
      if (!m.quoted) return m.reply('Open the status, reply to it with .savestatus')

      const from = m.quoted.sender ? `@${fn.cleanJid(m.quoted.sender)}` : 'someone'
      const mentions = m.quoted.sender ? [m.quoted.sender] : []
      let media = null
      try {
        media = await fn.downloadAny(m.quoted.message)
        if (!media) {
          const cached = sock.getCachedMessage(m.quoted.key.id)
          if (cached) media = await fn.downloadAny(cached)
        }
      } catch (err) {
        await sock.sendMessage(dm, { text: `savestatus failed: ${err.message || err}` }, { skipStyle: true })
        return quiet()
      }

      if (media) {
        await fn.sendViewOnceMedia(sock, dm, { ...media, caption: `Status from ${from}${media.caption ? `\n${media.caption}` : ''}` })
      } else if (m.quoted.text) {
        await sock.sendMessage(dm, { text: `Status from ${from}\n\n${m.quoted.text}`, mentions })
      } else {
        await sock.sendMessage(dm, { text: 'savestatus: that status could not be read.' }, { skipStyle: true })
      }
      await quiet()
    }
  },
  {
    name: 'poststatus',
    aliases: ['mystatus', 'poststory'],
    desc: 'Post a status on your account + every paired account (text, or reply image/video/audio)',
    category: 'owner',
    owner: true,
    subSafe: true,
    async run(sock, m, { text, prefix }) {
      const content = await resolveContent(m, text)
      if (!content) return m.reply(`Example: ${prefix}poststatus Good morning everyone\nor reply to an image/video with ${prefix}poststatus caption`)

      const reached = await postFrom(sock, content)
      if (sock.isSub) return m.reply(`Status posted (sent to ${reached} contacts).\nDelete it any time with ${prefix}delpost`)

      let ok = 0
      let failed = 0
      for (const ctl of sock.manager.listSubs()) {
        if (!ctl.sock?.user) {
          failed++
          continue
        }
        try {
          await fn.sleep(1500)
          await postFrom(ctl.sock, content)
          ok++
        } catch {
          failed++
        }
      }
      await m.reply(
        `Status posted on the main account (${reached} contacts)` +
          (ok || failed ? `\nand on ${ok} paired account${ok === 1 ? '' : 's'}${failed ? ` (${failed} offline or failed)` : ''}.` : '.') +
          `\n\nDelete every copy any time with ${prefix}delpost`
      )
    }
  },
  {
    name: 'postpairstatus',
    aliases: ['pairstatus'],
    desc: 'Post a status on paired accounts only, not the main Gideon account',
    category: 'owner',
    owner: true,
    async run(sock, m, { text, prefix }) {
      if (sock.isSub) return m.reply('This command is only available on the main Gideon bot.')
      const content = await resolveContent(m, text)
      if (!content) return m.reply(`Example: ${prefix}postpairstatus Good morning everyone\nor reply to an image/video with ${prefix}postpairstatus caption`)

      const subs = sock.manager.listSubs()
      if (!subs.length) return m.reply('No paired accounts yet. Use .pair <number>')
      let ok = 0
      let failed = 0
      for (const ctl of subs) {
        if (!ctl.sock?.user) {
          failed++
          continue
        }
        try {
          await fn.sleep(1500)
          await postFrom(ctl.sock, content)
          ok++
        } catch {
          failed++
        }
      }
      await m.reply(`Status posted on ${ok} paired account${ok === 1 ? '' : 's'}${failed ? ` (${failed} offline or failed)` : ''}.\n\nDelete it any time with ${prefix}delpost`)
    }
  },
  {
    name: 'delpost',
    aliases: ['delstatus', 'deletepost'],
    desc: 'Delete every status Gideon has posted, on the main + paired accounts',
    category: 'owner',
    owner: true,
    subSafe: true,
    async run(sock, m, { args, prefix }) {
      const scope = (args[0] || 'all').toLowerCase()
      const results = []

      if (sock.isSub) {
        const r = await deleteFrom(sock)
        return m.reply(r.total ? `Deleted ${r.done}/${r.total} post(s) from this account.` : 'No posts to delete from this account.')
      }

      if (scope === 'main' || scope === 'all') {
        const r = await deleteFrom(sock)
        results.push(`Main: ${r.total ? `deleted ${r.done}/${r.total}` : 'nothing to delete'}`)
      }
      if (scope === 'pairs' || scope === 'paired' || scope === 'all') {
        let ok = 0
        let total = 0
        let failed = 0
        for (const ctl of sock.manager.listSubs()) {
          if (!ctl.sock?.user) {
            failed++
            continue
          }
          const r = await deleteFrom(ctl.sock)
          ok += r.done
          total += r.total
          await fn.sleep(400)
        }
        results.push(`Paired: ${total ? `deleted ${ok}/${total}` : 'nothing to delete'}${failed ? ` (${failed} offline)` : ''}`)
      }
      if (!['main', 'pairs', 'paired', 'all'].includes(scope)) return m.reply(`Example: ${prefix}delpost (everything) • ${prefix}delpost main • ${prefix}delpost pairs`)
      await m.reply(`🗑️ *POSTS DELETED*\n\n${results.join('\n')}\n\nNote: only posts made since the bot last started can be tracked and deleted.`)
    }
  }
]
