export default {
    name: 'toimg',
    aliases: ['toimage', 'stickertoimg'],
    description: 'Turn a sticker back into an image',
    usage: 'toimg (reply to a sticker)',
    cooldown: 5,
    async run({ send, quoted, reply, raw }) {
        if (quoted?.type !== 'stickerMessage') return reply('🖼️ Reply to a sticker.');
        let sharp;
        try { sharp = (await import('sharp')).default; }
        catch { return reply('❌ Image tools are not installed. Run `npm install sharp`.'); }
        const png = await sharp(await quoted.download()).png().toBuffer();
        await send({ image: png, caption: '✅ Done' }, { quoted: raw });
    }
};
