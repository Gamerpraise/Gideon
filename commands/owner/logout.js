export default {
    name: 'logout',
    aliases: ['unlinkbot', 'deletebot'],
    description: 'Turn the bot off and delete your login from the server',
    usage: 'logout confirm',
    owner: true,
    async run({ args, reply, prefix, logoutBot }) {
        if ((args[0] || '').toLowerCase() !== 'confirm') {
            return reply(`⚠️ This stops the bot and *deletes your login from the server*.\n\nYou can pair again any time on the session site.\n\nTo continue, type: *${prefix}logout confirm*`);
        }
        await reply('👋 Bot removed. Your login has been deleted from the server. Bye!');
        setTimeout(() => logoutBot(), 1500);
    }
};
