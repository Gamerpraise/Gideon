// Lets the owner (Gpraise, on any hosted bot) start a brand-new bot straight from a WhatsApp chat —
// no need to visit the website. The code is sent back here, then this chat is notified once it connects.
export default {
    name: 'pair',
    description: 'Pair a new number and start Gideon on it, right from chat',
    usage: 'pair 2348012345678',
    owner: true, private: true, cooldown: 10,
    async run({ args, reply, chat, sock }) {
        const number = (args[0] || '').replace(/\D/g, '');
        if (number.length < 8 || number.length > 15 || number.startsWith('0')) {
            return reply('📱 Usage: *pair 2348012345678*\n(full international number, no + and no leading 0)');
        }

        const { hostingOn, slotsLeft } = await import('../../manager.js');
        if (!hostingOn()) return reply('⚠️ Bot hosting is off on this server.');
        if (!slotsLeft()) return reply('⚠️ No free bot slots right now. Try again later.');

        const { startSession } = await import('../../whatsapp.js');
        const { readJob } = await import('../../store.js');

        let started;
        try {
            started = await startSession({ phoneNumber: number });
        } catch (e) {
            return reply(`❌ ${e.message}`);
        }

        await reply(
`🔑 *Pairing code for +${number}*

*${started.code}*

Open WhatsApp on that phone → *Settings → Linked Devices → Link a device → Link with phone number instead* → enter the code.

I'll message you here once it connects (code expires in a few minutes).`
        );

        // watch for the result, then report back to this same chat
        const deadline = Date.now() + 4 * 60 * 1000;
        const poll = async () => {
            if (Date.now() > deadline) {
                return sock.sendMessage(chat, { text: `⌛ The pair code for +${number} timed out. Run *pair ${number}* again.` });
            }
            const job = readJob(started.id);
            if (!job) return sock.sendMessage(chat, { text: `⌛ The pair code for +${number} timed out. Run *pair ${number}* again.` });
            if (job.status === 'ready') return sock.sendMessage(chat, { text: `✅ *+${number} is now connected!* Gideon is starting on that number.` });
            if (job.status === 'error' || job.status === 'expired') return sock.sendMessage(chat, { text: `❌ Could not pair +${number}: ${job.error || 'unknown error'}` });
            setTimeout(poll, 3000);
        };
        setTimeout(poll, 3000);
    }
};
