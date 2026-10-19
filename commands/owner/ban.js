// Bot-level ban: the person can no longer use commands (they are NOT blocked on WhatsApp)
export default [
    {
        name: 'ban',
        description: 'Stop a person from using the bot',
        usage: 'ban @user',
        owner: true,
        async run({ target, db, reply, utils }) {
            if (!target) return reply('👤 Mention or reply to the person.');
            const id = utils.num(target);
            if (!db.data.banned.includes(id)) db.data.banned.push(id);
            db.save();
            reply(`🚫 ${id} can no longer use the bot.`);
        }
    },
    {
        name: 'unban',
        description: 'Let a banned person use the bot again',
        usage: 'unban @user',
        owner: true,
        async run({ target, db, reply, utils }) {
            if (!target) return reply('👤 Mention or reply to the person.');
            const id = utils.num(target);
            db.data.banned = db.data.banned.filter(x => x !== id);
            db.save();
            reply(`✅ ${id} is allowed again.`);
        }
    },
    {
        name: 'banlist',
        description: 'Show banned users',
        usage: 'banlist',
        owner: true,
        async run({ db, reply }) {
            const list = db.data.banned;
            reply(list.length ? `🚫 *Banned users*\n\n${list.map(n => '• +' + n).join('\n')}` : '✅ Nobody is banned.');
        }
    }
];
