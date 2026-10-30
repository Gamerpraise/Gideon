const fn = require('../functions')

// .savestatus  : swipe a status, reply to it with .savestatus -> it arrives in YOUR DM.
// Nothing is sent in the chat with the person, and your .savestatus message is deleted.
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
    desc: 'Post a status from your account (text, or reply image/video/audio)',
    category: 'owner',
    owner: true,
    subSafe: true,
    async run(sock, m, { text, prefix }) {
      const source = m.quoted || m
      const kind = (source.mtype || '').replace('Message', '')
      let content
      if (['image', 'video', 'audio'].includes(kind)) {
        const buffer = await source.download()
        if (kind === 'image') content = { image: buffer, caption: text }
        else if (kind === 'video') content = { video: buffer, caption: text }
        else content = { audio: buffer, mimetype: 'audio/mp4', ptt: true }
      } else {
        const body = text || m.quoted?.text
        if (!body) return m.reply(`Example: ${prefix}poststatus Good morning everyone\nor reply to an image/video with ${prefix}poststatus caption`)
        content = { text: body, backgroundColor: '#1a1a2e', font: 1 }
      }

      // Recipients: people an account has chatted with + members of its groups
      async function postFrom(account) {
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
        const statusJidList = [...list].slice(0, 1000)
        await account.sendMessage('status@broadcast', content, { statusJidList, skipStyle: true })
        return statusJidList.length
      }

      const reached = await postFrom(sock)
      if (sock.isSub) return m.reply(`Status posted (sent to ${reached} contacts).`)

      // main Gideon account: post on every paired account too
      let ok = 0
      let failed = 0
      for (const ctl of sock.manager.listSubs()) {
        if (!ctl.sock?.user) {
          failed++
          continue
        }
        try {
          await fn.sleep(1500)
          await postFrom(ctl.sock)
          ok++
        } catch {
          failed++
        }
      }
      await m.reply(`Status posted on the main account (${reached} contacts)` + (ok || failed ? `\nand on ${ok} paired account${ok === 1 ? '' : 's'}${failed ? ` (${failed} offline or failed)` : ''}.` : '.'))
    }
  }
]
