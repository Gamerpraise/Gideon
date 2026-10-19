export default {
    name: 'broadcast',
    aliases: ['bc'],
    description: 'Send a message to all groups the bot is in',
    usage: 'broadcast <message>',
    owner: true, cooldown: 30,
    async run({ sock, text, reply, config, utils }) {
        if (!text) return reply('✏️ Type the message to broadcast.');
        const groups = Object.keys(await sock.groupFetchAllParticipating());
        await reply(`📡 Sending to ${groups.length} groups…`);
        let ok = 0;
        for (const jid of groups) {
            try {
                await sock.sendMessage(jid, { text: `📢 *${config.botName} Broadcast*\n\n${text}` });
                ok++;
            } catch { /* skip */ }
            await utils.sleep(2000); // slow on purpose - fast broadcasts get accounts banned
        }
        reply(`✅ Delivered to ${ok}/${groups.length} groups.`);
    }
};
