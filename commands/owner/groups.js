export default {
    name: 'groups',
    aliases: ['listgroups', 'gclist'],
    description: 'List the groups the bot is in',
    usage: 'groups',
    owner: true,
    async run({ sock, reply }) {
        const all = Object.values(await sock.groupFetchAllParticipating());
        if (!all.length) return reply('I am not in any group yet.');
        reply(`👥 *Groups (${all.length})*\n\n` + all.map((g, i) => `${i + 1}. ${g.subject} (${g.participants.length})`).join('\n'));
    }
};
