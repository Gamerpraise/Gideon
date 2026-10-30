// Auto-reply that answers like you. It learns from WhatsApp chats exported into the "reply" folder.
//   .autoreply on|off     switch it (main Gideon account only)
//   .replies              what it has learned
//   .reloadreply          re-read the reply folder after adding exports
//   .replytest <text>     see how it would answer
const autoreply = require('../autoreply')
const engine = require('../replyengine')

module.exports = [
  {
    name: 'autoreply',
    aliases: ['ar'],
    desc: 'Auto-reply like you from exported chats: on/off',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const mode = (args[0] || '').toLowerCase()
      const db = store.get()
      if (!['on', 'off'].includes(mode)) return m.reply(`Example: .autoreply on | .autoreply off\nNow: ${db.autoreply?.enabled ? 'on' : 'off'}\n\nPut exported chats in the "reply" folder, then .reloadreply`)
      db.autoreply = { ...db.autoreply, enabled: mode === 'on' }
      store.save()
      const info = autoreply.reload()
      await m.reply(`Auto-reply ${mode}.${mode === 'on' ? `\nLearned ${info.pairs} replies from ${info.files.length} chat file(s).${info.pairs ? '' : '\nNo exports found yet, so it will only say "hmm 🤔". Add .txt exports to the reply folder.'}` : ''}`)
    }
  },
  {
    name: 'replies',
    aliases: ['replylist'],
    desc: 'Show what the auto-reply has learned',
    category: 'owner',
    owner: true,
    async run(sock, m, { store }) {
      autoreply.reload()
      const info = engine.info()
      const files = info.files.map((f) => `- ${f.name}: ${f.pairs} replies`).join('\n') || '- none'
      const skipped = info.skipped.length ? `\n\nCould not tell which side is you in:\n${info.skipped.map((f) => `- ${f}`).join('\n')}\nCreate reply/me.txt with your name as shown in the export.` : ''
      await m.reply(`Auto-reply: ${store.get().autoreply?.enabled ? 'on' : 'off'}\nLearned: ${info.pairs} replies\n\n${files}${skipped}`)
    }
  },
  {
    name: 'reloadreply',
    desc: 'Re-read the reply folder',
    category: 'owner',
    owner: true,
    async run(sock, m) {
      const info = autoreply.reload()
      await m.reply(`Reloaded. ${info.pairs} replies from ${info.files.length} file(s).`)
    }
  },
  {
    name: 'replytest',
    desc: 'Test how the auto-reply would answer: .replytest hello',
    category: 'owner',
    owner: true,
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .replytest how far')
      autoreply.reload()
      const r = engine.reply(`test:${m.chat}`, text)
      const top = engine.explain(text).map((c) => `- "${c.prompt.slice(0, 40)}" -> ${c.reply.slice(0, 50)} (${(c.score * 100).toFixed(0)}%)`).join('\n') || '- nothing learned yet'
      await m.reply(`It would say:\n${r.lines.join('\n')}\n\nMatch: ${r.kind}${r.kind === 'match' ? ` (${(r.score * 100).toFixed(0)}%)` : ''}\n\nClosest learned messages:\n${top}`)
    }
  }
]
