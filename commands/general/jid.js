export default {
    name: 'jid',
    aliases: ['id'],
    description: 'Show the id of this chat (and the replied-to user)',
    usage: 'jid',
    async run({ reply, chat, sender, quoted }) {
        let out = `💬 Chat: ${chat}\n👤 You: ${sender}`;
        if (quoted?.sender) out += `\n↩️ Replied user: ${quoted.sender}`;
        reply(out);
    }
};
