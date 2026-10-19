export default {
    name: 'alive',
    aliases: ['bot', 'status'],
    description: 'Check if the bot is online',
    usage: 'alive',
    async run({ reply, config, utils, commands, db, uptime }) {
        reply(
`✅ *${config.botName} is alive!*

⏱️ Uptime: ${utils.runtime(uptime())}
📦 Commands: ${commands.length}
🌐 Mode: ${db.data.settings.mode}
🕒 Time: ${utils.clock()}
👑 Owner: ${config.ownerName}

Type *${db.data.settings.prefix}menu* to see what I can do.`);
    }
};
