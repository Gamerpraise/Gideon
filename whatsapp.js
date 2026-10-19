// Everything that talks to WhatsApp: pair code / QR linking, then handing the login to the bot manager.
import fs from 'fs';
import os from 'os';
import path from 'path';
import pino from 'pino';
import {
    makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore,
    Browsers, DisconnectReason, jidNormalizedUser, delay
} from './baileys.js';
import { getWaVersion } from './utils.js';
import { createJob, updateJob, bumpTotal } from './store.js';
import * as manager from './manager.js';

const logger = pino({ level: 'silent' });
const TMP_ROOT = path.join(os.tmpdir(), 'gamerpraise-session'); // temp login folders live outside the project
const LINK_TIMEOUT = 5 * 60 * 1000;
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_SESSIONS || 40);
let active = 0;

export class HttpError extends Error {
    constructor(message, status = 503) { super(message); this.status = status; }
}

export function resetTmp() {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TMP_ROOT, { recursive: true });
}
const removeDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };

/* ---------------- one linking attempt ---------------- */
/**
 * Starts a linking attempt.
 *  - phoneNumber → pair-code mode, resolves with { id, code }
 *  - no number   → QR mode, resolves with { id, qr }  (newer QRs are stored on the job)
 * Once WhatsApp confirms the link, the login is handed to the bot manager and Gideon starts
 * running on that number immediately — nothing is shown to the person, nothing to upload.
 * Rejects with HttpError when linking cannot start.
 */
export function startSession({ phoneNumber = null } = {}) {
    return new Promise((resolve, reject) => {
        const id = createJob();
        const tag = id.slice(0, 6);
        const dir = path.join(TMP_ROOT, id); // random hex – never user input
        let sock = null, finished = false, delivering = false, pairRequested = false, restarts = 0, settled = false;

        const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };

        if (active >= MAX_ACTIVE) {
            updateJob(id, { status: 'error', error: 'Server is busy. Please try again in a minute.' });
            return reject(new HttpError('Server is busy. Please try again in a minute.', 503));
        }
        active++;
        fs.mkdirSync(dir, { recursive: true });

        const finish = () => {
            if (finished) return;
            finished = true; active--;
            clearTimeout(ttl);
            try { sock?.ev.removeAllListeners('connection.update'); sock?.ev.removeAllListeners('creds.update'); } catch { /* ignore */ }
            // Close (never log out!) so we don't fight the user's bot for the same session.
            try { sock?.end(undefined); } catch { /* ignore */ }
            setTimeout(() => removeDir(dir), 3000);
        };
        const fail = (message, status = 503) => {
            if (finished) return;
            updateJob(id, { status: 'error', error: message });
            settle(reject, new HttpError(message, status));
            finish();
        };
        const ttl = setTimeout(() => {
            if (finished) return;
            updateJob(id, { status: 'expired', error: 'Timed out. Please start again.' });
            settle(reject, new HttpError('Timed out. Please start again.', 408));
            finish();
        }, LINK_TIMEOUT);

        async function start() {
            if (finished) return;
            try {
                const { state, saveCreds } = await useMultiFileAuthState(dir);
                const version = await getWaVersion();

                sock = makeWASocket({
                    version, logger,
                    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
                    printQRInTerminal: false,
                    browser: Browsers.macOS('Chrome'),
                    markOnlineOnConnect: false,
                    syncFullHistory: false,
                    generateHighQualityLinkPreview: false,
                    defaultQueryTimeoutMs: 60000,
                    connectTimeoutMs: 60000,
                    keepAliveIntervalMs: 30000
                });

                sock.ev.on('creds.update', async () => {
                    if (finished) return;
                    try { await saveCreds(); } catch (e) { console.error(`[${tag}] saveCreds:`, e.message); }
                });

                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr && !phoneNumber) {
                        try {
                            const QRCode = (await import('qrcode')).default;
                            const dataUrl = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 1, width: 360 });
                            updateJob(id, { qr: dataUrl }); // WhatsApp rotates the QR every ~20s
                            settle(resolve, { id, qr: dataUrl });
                        } catch (e) { fail('Could not draw the QR code.', 500); }
                    }

                    if (connection === 'open' && !delivering) {
                        delivering = true;
                        console.log(`[${tag}] ✅ linked`);
                        try {
                            const me = jidNormalizedUser(sock.user?.id || state.creds.me?.id);
                            const number = me.split('@')[0].split(':')[0];
                            const hosted = manager.stage(number, dir); // 'ok' | 'full'
                            updateJob(id, { status: hosted === 'ok' ? 'ready' : 'error', number: '+' + number, error: hosted === 'full' ? 'Bot slots are full right now. Please try again later.' : undefined });
                            bumpTotal();
                            console.log(`[${tag}] 🎉 ${hosted === 'ok' ? 'handed to the bot manager' : 'no free slots'}`);
                            if (hosted === 'ok') {
                                finish(); // close this temporary connection first…
                                setTimeout(() => manager.launch(number), 2000); // …then start the real bot on the same login
                                return;
                            }
                        } catch (e) {
                            console.error(`[${tag}] handoff error:`, e);
                            return fail('Linked, but the bot could not be started. Please try again.');
                        }
                        setTimeout(finish, 3000);
                        return;
                    }

                    if (connection === 'close') {
                        if (finished || delivering) return;
                        const code = lastDisconnect?.error?.output?.statusCode;
                        console.log(`[${tag}] closed – status ${code ?? 'unknown'}: ${lastDisconnect?.error?.message || ''}`);

                        if (code === DisconnectReason.loggedOut) return fail('WhatsApp rejected the link. Please try again.', 401);

                        const paired = !!(state.creds.registered || state.creds.me);
                        // 515 = "restart required": WhatsApp always does this right after a successful link
                        if ((code === DisconnectReason.restartRequired || paired) && restarts < 5) {
                            restarts++;
                            try { sock.ev.removeAllListeners('connection.update'); sock.ev.removeAllListeners('creds.update'); } catch { /* ignore */ }
                            return setTimeout(start, 1000);
                        }
                        fail(`Could not connect to WhatsApp (status ${code ?? 'unknown'}). Please try again.`);
                    }
                });

                if (phoneNumber && !pairRequested && !state.creds.registered && !state.creds.me) {
                    pairRequested = true;
                    await delay(3000);
                    let code;
                    for (let i = 1; i <= 2 && !code; i++) {
                        try { code = await sock.requestPairingCode(phoneNumber); }
                        catch (e) { console.error(`[${tag}] pairing code (try ${i}):`, e?.message || e); await delay(2000); }
                    }
                    if (!code) return fail('Could not get a pair code. Check your number and try again.');
                    settle(resolve, { id, code: code.match(/.{1,4}/g)?.join('-') || code });
                }
            } catch (err) {
                console.error(`[${tag}] init error:`, err);
                fail('Service unavailable. Please try again.');
            }
        }
        start();
    });
}
