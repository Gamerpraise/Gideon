export default [
    {
        name: 'block',
        description: 'Block a WhatsApp user',
        usage: 'block @user (or reply / use in their chat)',
        owner: true,
        async run({ sock, target, isGroup, chat, reply }) {
            const jid = target || (!isGroup ? chat : null);
            if (!jid) return reply('👤 Mention, reply to, or type the number of the person.');
            await sock.updateBlockStatus(jid, 'block');
            reply('🚫 Blocked.');
        }
    },
    {
        name: 'unblock',
        description: 'Unblock a WhatsApp user',
        usage: 'unblock @user (or reply / use in their chat)',
        owner: true,
        async run({ sock, target, isGroup, chat, reply }) {
            const jid = target || (!isGroup ? chat : null);
            if (!jid) return reply('👤 Mention, reply to, or type the number of the person.');
            await sock.updateBlockStatus(jid, 'unblock');
            reply('✅ Unblocked.');
        }
    }
];
