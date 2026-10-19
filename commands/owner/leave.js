export default {
    name: 'leave',
    aliases: ['leavegc'],
    description: 'Make the bot leave this group',
    usage: 'leave',
    owner: true, group: true,
    async run({ sock, chat, reply }) {
        await reply('👋 Goodbye everyone!');
        await sock.groupLeave(chat);
    }
};
