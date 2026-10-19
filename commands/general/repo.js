export default {
    name: 'repo',
    aliases: ['script', 'github', 'channel', 'support'],
    description: 'Bot source code and WhatsApp channel',
    usage: 'repo',
    async run({ reply, config }) {
        reply(
`🤖 *${config.botName}*

⭐ GitHub: ${config.repoUrl}
📢 Channel: ${config.channelUrl}
👑 Made by: ${config.ownerName}

Fork it, deploy it, make it yours!`);
    }
};
