const sys = require('../sys')

module.exports = [
  {
    name: 'server',
    aliases: ['serverinfo', 'sysinfo', 'health'],
    desc: 'Owner: server RAM, CPU, disk and bot health',
    category: 'owner',
    owner: true,
    async run(sock, m, { config }) {
      await m.react('⏳')
      const s = await sys.serverInfo(sock.manager)
      const ramPct = Math.round((s.mem.used / s.mem.total) * 100)
      const lines = [
        `Bot uptime : ${require('../functions').runtime(process.uptime())}`,
        `RAM        : ${sys.mb(s.mem.used)} / ${sys.mb(s.mem.total)} (${ramPct}%), bot uses ${sys.mb(s.mem.bot)}`,
        `CPU        : ${s.cores} core(s), load ${s.load.map((v) => v.toFixed(2)).join(' ')}`,
        `Lag        : ${s.lag} ms ${s.lag > 150 ? '(slow, server is overloaded)' : s.lag > 50 ? '(a bit busy)' : '(smooth)'}`,
        `Disk       : ${sys.mb(s.disk.total)} / ${config.diskLimitMB} MB (${s.disk.percent}%)`,
        ...Object.entries(s.disk.parts).map(([k, v]) => `  ${k}: ${sys.mb(v)}`),
        `Bots       : ${s.online}/${s.bots.length} online (${s.bots.filter((b) => b.isSub).length} paired)`,
        `Node       : ${process.version}`
      ]
      if (s.disk.percent >= 80) lines.push('', `Disk is getting full. Send ${config.prefix}clear`)
      if (ramPct >= 90) lines.push('', 'RAM is almost full. Unpair some users or restart.')
      await m.reply(lines.join('\n'))
    }
  },
  {
    name: 'clear',
    aliases: ['cleardisk', 'cleanup', 'freespace'],
    desc: 'Owner: free disk space (.clear, or .clear deep)',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, config }) {
      const deep = (args[0] || '').toLowerCase() === 'deep'
      await m.react('⏳')
      const before = await sys.diskReport()
      const freed = deep ? await sys.clearDeep() : await sys.clearSafe()
      const after = await sys.diskReport()
      await m.reply(
        `${deep ? 'Deep clean' : 'Clean'} done\nFreed: ${sys.mb(Math.max(freed, before.total - after.total))}\nDisk: ${sys.mb(after.total)} / ${config.diskLimitMB} MB (${after.percent}%)\n\n${deep ? 'Also removed session files unused for 30+ days.' : `Removed temp files, npm cache and logs. ${config.prefix}clear deep also removes old unused session files.`}`
      )
    }
  }
]
