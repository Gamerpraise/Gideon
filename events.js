import config from './config.js';
import { invalidateMeta, getGroupMeta } from './handler.js';
import { num } from './utils.js';

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

export const DEFAULT_WELCOME = '👋 Welcome {user} to *{group}*!\n👥 You are member #{count}.\nPlease read the group rules. Enjoy! 🎉';
export const DEFAULT_GOODBYE = '👋 Goodbye {user}. We will miss you!';

export function registerEvents(sock, bot) {
    const db = bot.db;
    // someone joined / left / was promoted...
    sock.ev.on('group-participants.update', async (ev) => {
        try {
            invalidateMeta(bot, ev.id);
            if (ev.action !== 'add' && ev.action !== 'remove') return;
            const group = db.group(ev.id);
            const enabled = ev.action === 'add' ? group.welcome : group.goodbye;
            if (!enabled) return;

            const meta = await getGroupMeta(sock, ev.id, bot);
            for (const p of ev.participants) {
                const jid = typeof p === 'string' ? p : p.id;
                const tpl = (ev.action === 'add' ? group.welcomeText : group.goodbyeText)
                    || (ev.action === 'add' ? DEFAULT_WELCOME : DEFAULT_GOODBYE);
                const text = fill(tpl, {
                    user: `@${num(jid)}`,
                    group: meta?.subject || 'this group',
                    count: meta?.participants?.length ?? '?'
                });

                let image = null;
                try { image = await sock.profilePictureUrl(jid, 'image'); } catch { /* no picture */ }
                if (image) await sock.sendMessage(ev.id, { image: { url: image }, caption: text, mentions: [jid] });
                else await sock.sendMessage(ev.id, { text, mentions: [jid] });
            }
        } catch (e) {
            console.error('group-participants error:', e.message);
        }
    });

    sock.ev.on('groups.update', (updates) => updates.forEach(u => u.id && invalidateMeta(bot, u.id)));

    // reject calls
    sock.ev.on('call', async (calls) => {
        if (!db.data.settings.anticall) return;
        for (const call of calls) {
            if (call.status !== 'offer') continue;
            try {
                await sock.rejectCall(call.id, call.from);
                await sock.sendMessage(call.from, { text: `📵 Calls are not allowed. Please send a message instead.\n— ${config.botName}` });
            } catch (e) {
                console.error('anticall error:', e.message);
            }
        }
    });
}
