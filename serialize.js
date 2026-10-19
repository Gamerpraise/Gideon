// Turns a raw Baileys message into a friendly "m" object.
import { getContentType, jidNormalizedUser, downloadMediaMessage } from './baileys.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
const MEDIA = /^(image|video|audio|sticker|document)Message$/;

export const norm = (jid) => {
    try { return jid ? jidNormalizedUser(jid) : ''; } catch { return ''; }
};

export function botIds(sock) {
    return [norm(sock.user?.id), norm(sock.user?.lid)].filter(Boolean);
}

export function unwrap(message) {
    let viewOnce = false;
    while (message) {
        const wrapper = WRAPPERS.find(k => message[k]);
        if (!wrapper) break;
        if (wrapper.startsWith('viewOnce')) viewOnce = true;
        message = message[wrapper].message;
    }
    return { message, viewOnce };
}

function textOf(message, type) {
    const c = message?.[type];
    return message?.conversation || c?.text || c?.caption || c?.selectedButtonId || c?.selectedId || c?.singleSelectReply?.selectedRowId || '';
}

export function serialize(sock, raw) {
    if (!raw?.message || !raw?.key?.remoteJid) return null;
    const { message, viewOnce } = unwrap(raw.message);
    if (!message) return null;

    const type = getContentType(message);
    const content = message[type];
    const key = raw.key;
    const chat = key.remoteJid;
    const isGroup = chat.endsWith('@g.us');
    const ids = botIds(sock);

    const sender = key.fromMe ? ids[0] : norm(isGroup ? (key.participant || raw.participant) : chat);
    const senderAlt = key.fromMe ? '' : norm(isGroup ? key.participantAlt : key.remoteJidAlt);
    const ctx = (content && typeof content === 'object' && content.contextInfo) || {};

    const m = {
        raw, key, id: key.id, chat, isGroup,
        fromMe: !!key.fromMe,
        sender,
        senders: [sender, senderAlt].filter(Boolean), // a person can have a phone-number jid AND a lid
        pushName: raw.pushName || '',
        type,
        message,
        body: String(textOf(message, type) || ''),
        mentions: ctx.mentionedJid || [],
        isViewOnce: viewOnce || !!content?.viewOnce,
        mime: content?.mimetype || '',
        isMedia: MEDIA.test(type),
        quoted: null
    };

    m.download = () => downloadMediaMessage({ key, message }, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });

    if (ctx.quotedMessage) {
        const q = unwrap(ctx.quotedMessage);
        const qtype = getContentType(q.message || {});
        const qc = q.message?.[qtype];
        const qSender = norm(ctx.participant);
        const qkey = {
            remoteJid: chat,
            id: ctx.stanzaId,
            participant: ctx.participant,
            fromMe: ids.includes(qSender)
        };
        m.quoted = {
            id: ctx.stanzaId,
            key: qkey,
            sender: qSender,
            fromMe: qkey.fromMe,
            message: q.message,
            type: qtype,
            text: String(textOf(q.message, qtype) || ''),
            mime: qc?.mimetype || '',
            isMedia: MEDIA.test(qtype || ''),
            isViewOnce: q.viewOnce || !!qc?.viewOnce,
            download: () => downloadMediaMessage({ key: qkey, message: q.message }, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })
        };
    }
    return m;
}
