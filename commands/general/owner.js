export default {
    name: 'owner',
    aliases: ['creator', 'dev'],
    description: 'Get the owner contact',
    usage: 'owner',
    async run({ sock, chat, raw, config, reply, sock: { user } }) {
        const numbers = config.ownerNumbers.length ? config.ownerNumbers : [String(user.id).split('@')[0].split(':')[0]];
        const contacts = numbers.map((n, i) => ({
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${config.ownerName}${numbers.length > 1 ? ' ' + (i + 1) : ''}\nORG:${config.botName};\nTEL;type=CELL;type=VOICE;waid=${n}:+${n}\nEND:VCARD`
        }));
        await sock.sendMessage(chat, {
            contacts: { displayName: config.ownerName, contacts: contacts.map(c => ({ vcard: c.vcard })) }
        }, { quoted: raw });
    }
};
