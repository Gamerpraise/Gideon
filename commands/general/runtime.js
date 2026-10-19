export default {
    name: 'runtime',
    aliases: ['uptime'],
    description: 'How long the bot has been running',
    usage: 'runtime',
    async run({ reply, utils, uptime }) {
        reply(`⏱️ *Uptime:* ${utils.runtime(uptime())}`);
    }
};
