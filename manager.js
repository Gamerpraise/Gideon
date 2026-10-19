// Runs one Gideon bot per linked user, all inside this single server.
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import {
    makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore,
    Browsers, DisconnectReason, jidNormalizedUser
} from './baileys.js';
import config from './config.js';
import { getWaVersion, sleep, followChannel } from './utils.js';
import { createDb } from './botdb.js';
import { handleMessage } from './handler.js';
import { registerEvents } from './events.js';
import * as backup from './backup.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const AUTH_DIR = path.join(DATA_DIR, 'auth');
const MAX_BOTS = Number(process.env.MAX_BOTS || 10);
const BACKUP_EVERY = Number(process.env.BACKUP_EVERY_MIN || 3) * 60_000;
const logger = pino({ level: 'silent' });

const bots = new Map(); // number -> bot
let backupTimer = null;

export const hostingOn = () => process.env.BOT_HOSTING !== 'off';
export const botCount = () => bots.size;
export const slotsLeft = () => Math.max(0, MAX_BOTS - bots.size);
export const info = () => ({ enabled: hostingOn(), slotsLeft: slotsLeft(), max: MAX_BOTS, persistent: backup.backupEnabled() });

const log = (bot, ...a) => console.log(`[bot ${bot.number.slice(-4)}]`, ...a);

/* ---------------- socket helpers ---------------- */
const EVENTS = ['connection.update', 'creds.update', 'messages.upsert', 'group-participants.update', 'groups.update', 'call'];

function closeSock(bot) {
    clearInterval(bot.onlineTimer);
    clearTimeout(bot.reconnectTimer);
    const sock = bot.sock;
    bot.sock = null;
    bot.connected = false;
    if (!sock) return;
    for (const e of EVENTS) { try { sock.ev.removeAllListeners(e); } catch { /* ignore */ } }
    try { sock.end(undefined); } catch { /* ignore */ }
}

function scheduleReconnect(bot) {
    if (bot.stopped) return;
    closeSock(bot);
    const wait = Math.min(60_000, 2000 * 2 ** Math.min(bot.retries++, 5));
    log(bot, `reconnecting in ${wait / 1000}s`);
    bot.reconnectTimer = setTimeout(() => connect(bot), wait);
}

async function destroy(bot, reason) {
    log(bot, `removed (${reason})`);
    bot.stopped = true;
    closeSock(bot);
    bots.delete(bot.number);
    try { fs.rmSync(bot.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    await backup.deleteBot(bot.number);
}

/* ---------------- one connection ---------------- */
async function connect(bot) {
    if (bot.stopped) return;
    try {
        const { state, saveCreds } = await useMultiFileAuthState(bot.dir);
        if (!state.creds.registered && !state.creds.me) return destroy(bot, 'invalid session files');
        const version = await getWaVersion();

        const sock = makeWASocket({
            version, logger,
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
            browser: Browsers.macOS('Chrome'),
            printQRInTerminal: false,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            cachedGroupMetadata: async (jid) => bot.metaCache.get(jid)?.meta,
            getMessage: async (key) => bot.msgCache.get(key.id)?.message
        });
        bot.sock = sock;

        sock.ev.on('creds.update', async () => {
            try { await saveCreds(); } catch (e) { log(bot, 'saveCreds:', e.message); }
        });
        registerEvents(sock, bot);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (bot.sock !== sock) return; // stale socket
            if (connection === 'open') {
                bot.retries = 0;
                bot.connected = true;
                log(bot, '✅ online');
                onOpen(bot, sock);
            }
            if (connection === 'close') {
                bot.connected = false;
                const code = lastDisconnect?.error?.output?.statusCode;
                log(bot, `closed (status ${code ?? 'unknown'})`);
                if (code === DisconnectReason.loggedOut) return destroy(bot, 'user logged out from WhatsApp');
                if (code === DisconnectReason.connectionReplaced) {
                    log(bot, 'this session is open somewhere else – stopped');
                    bot.stopped = true;
                    return closeSock(bot);
                }
                scheduleReconnect(bot);
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            for (const raw of messages) {
                // Right after pairing, WhatsApp delivers a short burst of recent history as
                // type "append" (not "notify") while it syncs the new linked device. A command
                // typed in that window would otherwise be silently ignored. We still skip genuinely
                // OLD history (so the bot doesn't replay months-old messages as commands) but let
                // anything from the last 2 minutes through, "append" or not.
                const ageSec = Date.now() / 1000 - (Number(raw.messageTimestamp) || 0);
                if (type !== 'notify' && ageSec > 120) continue;
                try { await handleMessage(sock, raw, bot); }
                catch (e) { log(bot, 'handler error:', e.message); }
            }
        });
    } catch (e) {
        log(bot, 'connect error:', e.message);
        scheduleReconnect(bot);
    }
}

async function onOpen(bot, sock) {
    clearInterval(bot.onlineTimer);
    bot.onlineTimer = setInterval(() => {
        if (bot.db.data.settings.alwaysonline) sock.sendPresenceUpdate('available').catch(() => {});
    }, 30_000);

    if (config.autoFollowChannel) {
        followChannel(sock, config.channelUrl).then((ok) => { bot.channelFollowed = ok; });
    }

    if (!bot.db.data.welcomed) {
        bot.db.data.welcomed = true;
        bot.db.flush();
        const p = bot.db.data.settings.prefix;
        await sleep(1200); // let the follow attempt above settle first
        sock.sendMessage(jidNormalizedUser(sock.user.id), {
            text:
`✅ *Gideon connected successfully!*

I'm now active on this number. Send *${p}menu* in any chat to see everything I can do.

📢 I also tried to follow our WhatsApp channel so you'll see updates and know when to run *${p}update*.

ℹ️ This bot is managed by *${config.ownerName}* — settings and admin commands are locked to keep every hosted bot safe and consistent. You can still use every regular command freely.

🚪 Remove the bot any time with *${p}logout confirm*, or unlink the device in WhatsApp → Linked devices.`
        }).catch(() => {});
    }
}

/* ---------------- create / stop ---------------- */
function createBot(number) {
    const dir = path.join(AUTH_DIR, number);
    const bot = {
        number, dir,
        ownerNumbers: config.ownerNumbers, // fixed owner on every hosted bot — never the linked number
        db: createDb(path.join(dir, 'gideon-db.json')),
        msgCache: new Map(),
        metaCache: new Map(),
        sock: null, stopped: false, connected: false, retries: 0, startedAt: Date.now()
    };
    bot.uptime = () => (Date.now() - bot.startedAt) / 1000;
    bot.restart = async () => { closeSock(bot); bot.retries = 0; bot.startedAt = Date.now(); bot.reconnectTimer = setTimeout(() => connect(bot), 1000); };
    bot.logout = async () => {
        try { await bot.sock?.logout(); } catch { /* ignore */ }
        await destroy(bot, 'owner used .logout');
    };
    bots.set(number, bot);
    connect(bot);
    return bot;
}

/** Called right after a user links. Copies the login into permanent storage. Returns 'ok' | 'full' | 'off'. */
export function stage(number, srcDir) {
    if (!hostingOn()) return 'off';
    if (!bots.has(number) && bots.size >= MAX_BOTS) return 'full';
    const old = bots.get(number);
    if (old) { old.stopped = true; closeSock(old); bots.delete(number); }
    const dest = path.join(AUTH_DIR, number);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(srcDir, dest, { recursive: true });
    return 'ok';
}

export function launch(number) {
    if (!bots.has(number)) createBot(number);
}

/* ---------------- boot / shutdown ---------------- */
async function snapshotAll() {
    for (const bot of bots.values()) {
        try {
            bot.db.flush();
            await backup.saveBot(bot.number, bot.dir);
        } catch (e) { log(bot, 'backup failed:', e.message); }
    }
}

export async function restoreAll() {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    if (!hostingOn()) return console.log('ℹ️ Bot hosting is OFF (BOT_HOSTING=off)');

    if (await backup.initBackup()) {
        for (const { number, files } of await backup.loadAll()) {
            const dir = path.join(AUTH_DIR, number);
            if (!fs.existsSync(path.join(dir, 'creds.json'))) backup.writeDirFiles(dir, files); // keep local copy if the disk survived
        }
        backupTimer = setInterval(snapshotAll, BACKUP_EVERY);
        backupTimer.unref();
    } else {
        console.log('ℹ️ No backup configured – hosted bots are lost if this server\'s disk is wiped (see README).');
    }

    const numbers = fs.readdirSync(AUTH_DIR).filter(n => /^\d{6,16}$/.test(n) && fs.existsSync(path.join(AUTH_DIR, n, 'creds.json')));
    console.log(`🤖 Starting ${Math.min(numbers.length, MAX_BOTS)} saved bot(s)…`);
    for (const number of numbers.slice(0, MAX_BOTS)) {
        createBot(number);
        await sleep(1500); // stagger so we don't hammer WhatsApp / RAM at boot
    }
}

export async function shutdown() {
    clearInterval(backupTimer);
    await snapshotAll();
    for (const bot of bots.values()) { bot.stopped = true; closeSock(bot); }
}
