const ORDER = ['general', 'group', 'tools', 'fun', 'ai', 'owner'];
const ICONS = { general: '🏠', group: '👥', tools: '🛠️', fun: '🎮', ai: '🤖', owner: '👑' };

export default {
    name: 'menu',
    aliases: ['commands', 'list', 'start'],
    description: 'Show all commands (or one category)',
    usage: 'menu [category]',
    async run({ reply, send, m, args, prefix, commands, config, db, isOwner, utils, raw, uptime }) {
        const wanted = (args[0] || '').toLowerCase();
        const cats = {};
        for (const c of commands) {
            if (c.category === 'owner' && !isOwner) continue;
            (cats[c.category] ||= []).push(c);
        }
        const names = Object.keys(cats).sort((a, b) => {
            const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
        });

        if (wanted && !cats[wanted]) return reply(`❌ No category "${wanted}".\nCategories: ${names.join(', ')}`);

        const header =
`╭━━━『 *${config.botName.toUpperCase()}* 』━━━╮
┃ 👋 Hi *${m.pushName || 'there'}*, ${utils.greeting()}
┃ ⚙️ Prefix : *${prefix}*
┃ 🌐 Mode   : *${db.data.settings.mode}*
┃ ⏱️ Uptime : *${utils.runtime(uptime())}*
┃ 📦 Commands : *${commands.length}*
┃ 👑 Owner  : *${config.ownerName}*
╰━━━━━━━━━━━━━━━━━━━━╯\n`;

        const show = wanted ? [wanted] : names;
        let body = '';
        for (const cat of show) {
            const list = cats[cat].slice().sort((a, b) => a.name.localeCompare(b.name));
            body += `\n╭─「 ${ICONS[cat] || '📁'} *${cat.toUpperCase()}* 」\n`;
            body += list.map(c => wanted ? `│ ➤ *${prefix}${c.name}* — ${c.description || ''}` : `│ ➤ ${prefix}${c.name}`).join('\n');
            body += '\n╰──────────────\n';
        }
        const footer = `\n💡 *${prefix}help <command>* for details\n📢 ${config.channelUrl}\n_© ${config.ownerName}_`;
        const text = header + body + footer;

        if (config.menuImage) {
            try {
                return await send({ image: { url: config.menuImage }, caption: text }, { quoted: raw });
            } catch { /* fall back to text */ }
        }
        return reply(text);
    }
};
