export default {
    name: 'join',
    description: 'Make the bot join a group via invite link',
    usage: 'join https://chat.whatsapp.com/xxxx',
    owner: true,
    async run({ sock, text, quoted, reply }) {
        const match = (text || quoted?.text || '').match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
        if (!match) return reply('🔗 Send a valid group invite link.');
        await sock.groupAcceptInvite(match[1]);
        reply('✅ Joined!');
    }
};
