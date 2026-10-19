export default {
    name: 'ping',
    aliases: ['speed', 'p'],
    description: 'Check how fast the bot responds',
    usage: 'ping',
    async run({ sock, chat, m, raw }) {
        const start = Date.now();
        const sent = await sock.sendMessage(chat, { text: '🏓 Pinging...' }, { quoted: raw });
        const ms = Date.now() - start;
        await sock.sendMessage(chat, { text: `🏓 *Pong!* ${ms}ms`, edit: sent.key });
    }
};
