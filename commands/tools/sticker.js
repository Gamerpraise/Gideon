export default {
    name: 'sticker',
    aliases: ['s', 'stiker'],
    description: 'Turn an image/video/GIF into a sticker',
    usage: 'sticker [pack | author] (reply to media or send media with this caption)',
    cooldown: 5,
    async run({ send, m, quoted, text, reply, config, raw }) {
        const src = (m.isMedia && ['imageMessage', 'videoMessage', 'stickerMessage'].includes(m.type)) ? m
            : (quoted?.isMedia && ['imageMessage', 'videoMessage', 'stickerMessage'].includes(quoted.type)) ? quoted : null;
        if (!src) return reply('🖼️ Reply to an image, short video or GIF with this command.');

        let mod;
        try { mod = await import('wa-sticker-formatter'); }
        catch { return reply('❌ Sticker maker is not installed. Run `npm install wa-sticker-formatter sharp`.'); }
        const lib = mod.Sticker ? mod : mod.default;

        const [pack, author] = text.split('|').map(s => s?.trim());
        const buffer = await src.download();
        const sticker = new lib.Sticker(buffer, {
            pack: pack || config.botName,
            author: author || config.ownerName,
            type: lib.StickerTypes.FULL,
            quality: 60
        });
        await send({ sticker: await sticker.toBuffer() }, { quoted: raw });
    }
};
