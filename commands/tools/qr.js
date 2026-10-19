export default {
    name: 'qr',
    aliases: ['qrcode'],
    description: 'Create a QR code from text or a link',
    usage: 'qr <text>',
    async run({ send, text, reply, quoted, raw }) {
        const data = text || quoted?.text;
        if (!data) return reply('✏️ Type the text or link for the QR code.');
        const { default: QRCode } = await import('qrcode');
        const png = await QRCode.toBuffer(data, { width: 600, margin: 2 });
        await send({ image: png, caption: '✅ Here is your QR code' }, { quoted: raw });
    }
};
