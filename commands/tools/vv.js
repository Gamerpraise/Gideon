export default {
    name: 'vv',
    aliases: ['viewonce', 'reveal'],
    description: 'Reveal a view-once photo/video/voice note',
    usage: 'vv (reply to a view-once message)',
    owner: true,
    async run({ send, quoted, reply, raw }) {
        if (!quoted?.isViewOnce) return reply('👁️ Reply to a view-once message.');
        const buffer = await quoted.download();
        const caption = quoted.text || '';
        if (quoted.type === 'imageMessage') await send({ image: buffer, caption }, { quoted: raw });
        else if (quoted.type === 'videoMessage') await send({ video: buffer, caption }, { quoted: raw });
        else if (quoted.type === 'audioMessage') await send({ audio: buffer, mimetype: 'audio/mpeg', ptt: true }, { quoted: raw });
        else reply('⚠️ That type of message is not supported.');
    }
};
