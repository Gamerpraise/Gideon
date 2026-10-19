export default {
    name: 'help',
    aliases: ['cmdinfo'],
    description: 'Show details about one command',
    usage: 'help <command>',
    async run({ args, reply, prefix, commands }) {
        const q = (args[0] || '').toLowerCase().replace(/^[^a-z0-9]+/, '');
        if (!q) return reply(`Usage: *${prefix}help <command>*\nExample: *${prefix}help sticker*\n\nSee all commands with *${prefix}menu*`);
        const cmd = commands.find(c => c.name === q || c.aliases.includes(q));
        if (!cmd) return reply(`❌ I don't have a command called "${q}".`);

        const rules = [
            cmd.owner && 'owner only', cmd.group && 'groups only', cmd.private && 'private chat only',
            cmd.admin && 'group admins', cmd.botAdmin && 'bot must be admin'
        ].filter(Boolean);

        reply(
`📖 *${prefix}${cmd.name}*
📝 ${cmd.description || 'No description'}
💡 Usage: ${prefix}${cmd.usage || cmd.name}
📁 Category: ${cmd.category}
🔁 Aliases: ${cmd.aliases.length ? cmd.aliases.map(a => prefix + a).join(', ') : 'none'}
🔒 Rules: ${rules.length ? rules.join(', ') : 'anyone can use it'}`);
    }
};
