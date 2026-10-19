// Handles every incoming message for ONE hosted bot ("bot" = that user's instance: its own settings, caches, owner).
import config from './config.js';
import * as utils from './utils.js';
import { serialize, norm, botIds } from './serialize.js';
import { registry, commandList, loadCommands } from './loader.js';

const { num } = utils;
const LINK_REGEX = /(https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+/i;
const cooldowns = new Map();

/* ---------------- per-bot caches ---------------- */
function remember(bot, raw) {
    if (!raw?.key?.id) return;
    bot.msgCache.set(raw.key.id, raw);
    if (bot.msgCache.size > 400) bot.msgCache.delete(bot.msgCache.keys().next().value);
}

export function invalidateMeta(bot, jid) { bot.metaCache.delete(jid); }

export async function getGroupMeta(sock, jid, bot) {
    const hit = bot.metaCache.get(jid);
    if (hit && Date.now() - hit.t < 60_000) return hit.meta;
    try {
        const meta = await sock.groupMetadata(jid);
        bot.metaCache.set(jid, { t: Date.now(), meta });
        if (bot.metaCache.size > 200) bot.metaCache.delete(bot.metaCache.keys().next().value);
        return meta;
    } catch {
        return hit?.meta || null;
    }
}

// every id a participant might be known by (phone jid and/or lid)
const idsOf = (p) => [p.id, p.lid, p.phoneNumber, p.jid].map(norm).filter(Boolean);

async function handleRevoke(sock, raw, bot) {
    const proto = raw.message?.protocolMessage;
    if (!bot.db.data.settings.antidelete || !proto?.key?.id) return;
    const old = bot.msgCache.get(proto.key.id);
    if (!old || old.key.fromMe) return;
    const me = botIds(sock)[0];
    const who = norm(old.key.participant || old.key.remoteJid);
    await sock.sendMessage(me, {
        text: `🗑️ *Deleted message caught*\n👤 @${num(who)}\n💬 ${old.key.remoteJid.endsWith('@g.us') ? 'Group' : 'Private chat'}`,
        mentions: [who]
    });
    await sock.sendMessage(me, { forward: old });
}

/* ---------------- main entry ---------------- */
export async function handleMessage(sock, raw, bot) {
    const db = bot.db;
    if (raw.message?.protocolMessage?.type === 0) return handleRevoke(sock, raw, bot); // someone deleted a message
    remember(bot, raw);

    const settings = db.data.settings;
    const chatJid = raw.key?.remoteJid || '';

    if (chatJid === 'status@broadcast') {
        if (settings.autoviewstatus) await sock.readMessages([raw.key]).catch(() => {});
        return;
    }
    if (chatJid.endsWith('@broadcast') || chatJid.endsWith('@newsletter')) return;

    const m = serialize(sock, raw);
    if (!m) return;

    // Fast exit: we only care about commands, antilink groups and nothing else (we never read or store chats).
    const prefix = settings.prefix || config.prefix;
    const isCommandText = m.body.startsWith(prefix);
    const antilinkOn = m.isGroup && db.data.groups[m.chat]?.antilink && db.data.groups[m.chat].antilink !== 'off';
    if (!isCommandText && !antilinkOn) {
        if (settings.autoread) sock.readMessages([m.key]).catch(() => {});
        return;
    }
    if (settings.autoread) sock.readMessages([m.key]).catch(() => {});

    /* ----- who is this? ----- */
    const meta = m.isGroup ? await getGroupMeta(sock, m.chat, bot) : null;
    const participants = meta?.participants || [];
    if (meta) {
        const me = participants.find(p => idsOf(p).some(id => m.senders.includes(id)));
        if (me) for (const id of idsOf(me)) if (!m.senders.includes(id)) m.senders.push(id);
    }

    const ids = botIds(sock);
    // Owner is a FIXED list (config.ownerNumbers), never the linked number itself and never "fromMe" —
    // otherwise the person who linked their own phone could grant themselves owner powers on their own bot.
    const ownerNumbers = new Set(bot.ownerNumbers);
    const isOwner = m.senders.some(j => ownerNumbers.has(num(j)));
    const adminIds = new Set(participants.filter(p => p.admin).flatMap(idsOf));
    const isAdmin = m.senders.some(j => adminIds.has(j));
    const isBotAdmin = ids.some(j => adminIds.has(j));

    const reply = (text, opts = {}) => sock.sendMessage(m.chat, { text, ...opts }, { quoted: raw });
    const react = (emoji) => sock.sendMessage(m.chat, { react: { text: emoji, key: m.key } });
    const group = m.isGroup ? db.group(m.chat) : null;

    /* ----- antilink ----- */
    if (group && group.antilink !== 'off' && !isAdmin && !isOwner && !m.fromMe && LINK_REGEX.test(m.body)) {
        if (isBotAdmin) {
            await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {});
            const mode = group.antilink;
            const who = num(m.sender);
            if (mode === 'warn' || mode === 'kick') {
                group.warns[who] = (group.warns[who] || 0) + 1;
                db.save();
                if (mode === 'kick' || group.warns[who] >= config.maxWarns) {
                    await sock.sendMessage(m.chat, { text: `🚫 @${who} was removed for sending links.`, mentions: [m.sender] });
                    await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {});
                    delete group.warns[who];
                    db.save();
                } else {
                    await sock.sendMessage(m.chat, { text: `⚠️ @${who}, links are not allowed here! Warning ${group.warns[who]}/${config.maxWarns}`, mentions: [m.sender] });
                }
            } else {
                await sock.sendMessage(m.chat, { text: `⚠️ @${who}, links are not allowed here!`, mentions: [m.sender] });
            }
            return;
        }
    }

    /* ----- is it a command? ----- */
    if (!isCommandText) return;
    if (!isOwner && db.data.banned.includes(num(m.sender))) return;
    if (settings.mode === 'private' && !isOwner) return;

    const afterPrefix = m.body.slice(prefix.length).trim();
    if (!afterPrefix) return;
    const command = afterPrefix.split(/\s+/)[0].toLowerCase();
    const cmd = registry.get(command);
    if (!cmd) return;

    const text = afterPrefix.slice(command.length).trim();
    const args = text ? text.split(/\s+/) : [];
    const msgs = config.messages;

    /* ----- permissions ----- */
    if (cmd.owner && !isOwner) return reply(msgs.owner);
    if (cmd.group && !m.isGroup) return reply(msgs.group);
    if (cmd.private && m.isGroup) return reply(msgs.private);
    if (cmd.admin && m.isGroup && !isAdmin && !isOwner) return reply(msgs.admin);
    if (cmd.botAdmin && m.isGroup && !isBotAdmin) return reply(msgs.botAdmin);

    if (!isOwner) {
        const k = `${bot.number}:${cmd.name}:${num(m.sender)}`;
        const wait = (cmd.cooldown ?? 2) * 1000;
        if (Date.now() - (cooldowns.get(k) || 0) < wait) return reply(msgs.cooldown);
        cooldowns.set(k, Date.now());
        if (cooldowns.size > 5000) cooldowns.clear();
    }

    /* ----- targets: @mentions, replied-to user, or a typed number ----- */
    const targets = [...new Set([
        ...m.mentions,
        ...(m.quoted?.sender ? [m.quoted.sender] : []),
        ...args.filter(a => /^\+?\d{7,15}$/.test(a)).map(utils.toJid)
    ])].filter(j => !ids.includes(norm(j)));

    if (settings.autotyping) sock.sendPresenceUpdate('composing', m.chat).catch(() => {});

    const ctx = {
        sock, m, raw, bot, chat: m.chat, sender: m.sender, isGroup: m.isGroup,
        isOwner, isAdmin, isBotAdmin, meta, participants, group,
        command, args, text, prefix, quoted: m.quoted,
        targets, target: targets[0] || null,
        reply, react,
        send: (content, opts = {}) => sock.sendMessage(m.chat, content, opts),
        config, // owner is fixed globally (config.ownerNumbers) – identical on every hosted bot
        db, utils,
        uptime: bot.uptime,
        commands: commandList,
        reloadCommands: loadCommands,
        restartBot: bot.restart,
        logoutBot: bot.logout
    };

    try {
        await cmd.run(ctx);
    } catch (err) {
        console.error(`❌ [bot ${bot.number.slice(-4)}] command "${cmd.name}":`, err.message);
        await reply(`❌ *${cmd.name}* failed: ${err.message || 'unknown error'}`).catch(() => {});
    }
}
