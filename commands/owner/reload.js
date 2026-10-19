export default {
    name: 'reload',
    description: 'Reload all command files without restarting',
    usage: 'reload',
    owner: true,
    async run({ reply, reloadCommands }) {
        const { count, errors } = await reloadCommands();
        reply(`✅ Reloaded *${count}* commands.` + (errors.length ? `\n\n⚠️ Problems:\n${errors.join('\n')}` : ''));
    }
};
