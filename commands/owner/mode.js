export default {
    name: 'mode',
    description: 'Switch between public and private mode',
    usage: 'mode public|private',
    owner: true,
    async run({ args, reply, db, prefix }) {
        const v = (args[0] || '').toLowerCase();
        if (!['public', 'private'].includes(v)) return reply(`🌐 Mode is *${db.data.settings.mode}*\nUse: ${prefix}mode public|private`);
        db.data.settings.mode = v;
        db.save();
        reply(`✅ Mode set to *${v}*${v === 'private' ? ' – only the owner can use me now.' : '.'}`);
    }
};
