export default {
    name: 'setprefix',
    description: 'Change the command prefix',
    usage: 'setprefix <symbol>',
    owner: true,
    async run({ args, reply, db, prefix }) {
        const p = args[0];
        if (!p || p.length > 3) return reply(`⚙️ Current prefix: *${prefix}*\nUse: ${prefix}setprefix !  (1-3 characters)`);
        db.data.settings.prefix = p;
        db.save();
        reply(`✅ Prefix changed to *${p}*`);
    }
};
