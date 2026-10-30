const updater = require('../updater')

// .update          download the newest code from GitHub, then restart
// .update check    only look, do not install
module.exports = {
  name: 'update',
  aliases: ['gitpull'],
  desc: 'Owner: update the bot from GitHub',
  category: 'owner',
  owner: true,
  dangerous: true,
  async run(sock, m, { args, config, store }) {
    const mode = (args[0] || '').toLowerCase()
    const db = store.get()
    let info = null
    try {
      info = await updater.latest()
    } catch (err) {
      if (mode === 'check') return m.reply(`Could not reach GitHub.\n${err.message}`)
    }

    if (mode === 'check') {
      const upToDate = info.sha === db.updateSha
      return m.reply(
        `Repo: ${config.repo} (${config.repoBranch})\nLatest: ${info.message}\n${info.date ? `Date: ${new Date(info.date).toLocaleString('en-GB', { timeZone: config.timezone })}\n` : ''}Status: ${upToDate ? 'you are up to date' : `update available, send ${config.prefix}update`}`
      )
    }

    if (info && info.sha === db.updateSha && mode !== 'force') {
      return m.reply('Already up to date. Use .update force to reinstall anyway.')
    }

    await m.reply(`Updating from ${config.repo}...`)
    try {
      const result = await updater.apply()
      if (info) {
        db.updateSha = info.sha
        db.updateNotified = info.sha
        store.save()
      }
      await m.reply(`Update done. ${result.changed} file(s) changed${result.depsChanged ? ', dependencies installed' : ''}.\nRestarting now, back in a few seconds.`)
      setTimeout(() => process.exit(42), 1500)
    } catch (err) {
      await m.reply(`Update failed.\n${err.message || err}\n\nNothing was restarted.`)
    }
  }
}
