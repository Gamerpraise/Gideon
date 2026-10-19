export default {
    name: 'getpp',
    aliases: ['pp', 'profilepic'],
    description: 'Get someone\'s profile picture',
    usage: 'getpp @user (or reply)',
    cooldown: 5,
    async run({ sock, send, target, sender, reply, raw }) {
        const jid = target || sender;
        let url;
        try { url = await sock.profilePictureUrl(jid, 'image'); }
        catch { return reply('❌ No profile picture (or it is hidden).'); }
        await send({ image: { url }, caption: '🖼️ Profile picture' }, { quoted: raw });
    }
};
