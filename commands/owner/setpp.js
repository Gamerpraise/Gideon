export default {
    name: 'setpp',
    aliases: ['setbotpp'],
    description: 'Set the bot profile picture (reply to an image)',
    usage: 'setpp (reply to an image)',
    owner: true,
    async run({ sock, quoted, m, reply }) {
        const src = m.type === 'imageMessage' ? m : quoted?.type === 'imageMessage' ? quoted : null;
        if (!src) return reply('🖼️ Reply to an image (or send one with this caption).');
        const buf = await src.download();
        await sock.updateProfilePicture(sock.user.id, buf);
        reply('✅ Profile picture updated.');
    }
};
