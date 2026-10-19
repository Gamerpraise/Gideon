export default {
    name: 'restart',
    aliases: ['reboot'],
    description: 'Restart your bot',
    usage: 'restart',
    owner: true,
    async run({ reply, restartBot }) {
        await reply('🔄 Restarting your bot… give me a few seconds.');
        restartBot();
    }
};
