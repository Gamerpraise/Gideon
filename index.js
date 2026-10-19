import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { rateLimit, readJob, getTotal } from './store.js';
import { startSession, resetTmp, HttpError } from './whatsapp.js';
import * as manager from './manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8000;
const app = express();

EventEmitter.defaultMaxListeners = 500;
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render and most hosts sit behind a proxy

resetTmp(); // clear half-finished logins from a previous run

app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
    });
    next();
});

// Only these routes exist – project files are never served.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (req, res) => res.send('ok')); // point an uptime pinger here to keep a free host awake

const api = express.Router();
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

api.get('/config', (req, res) => {
    res.send({
        siteName: process.env.SITE_NAME || 'Gideon',
        links: {
            youtube: process.env.YOUTUBE_URL || 'https://youtube.com/@gamerpraise-mods',
            github: process.env.GITHUB_URL || 'https://github.com/Gamerpraise/',
            channel: process.env.CHANNEL_URL || 'https://whatsapp.com/channel/0029VbBRPc3CMY0IePiiU808'
        },
        total: getTotal(),
        hosting: manager.info()
    });
});

api.get('/total', (req, res) => res.send({ total: getTotal() }));

const fail = (res, e) => {
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).send({ error: e.message || 'Something went wrong. Please try again.' });
};

api.get('/pair', rateLimit(8), async (req, res) => {
    if (!manager.hostingOn()) return res.status(503).send({ error: 'Bot hosting is currently off.' });
    if (!manager.slotsLeft()) return res.status(503).send({ error: 'Bot slots are full right now. Please try again later.' });
    const number = String(req.query.number || '').replace(/\D/g, '');
    if (!number) return res.status(400).send({ error: 'Please enter your WhatsApp number.' });
    if (number.startsWith('0') || number.length < 8 || number.length > 15) {
        return res.status(400).send({ error: 'Use your full international number without + or spaces, and without a leading 0 (example: 2348012345678).' });
    }
    try { res.send(await startSession({ phoneNumber: number })); }
    catch (e) { fail(res, e); }
});

api.get('/qr', rateLimit(8), async (req, res) => {
    if (!manager.hostingOn()) return res.status(503).send({ error: 'Bot hosting is currently off.' });
    if (!manager.slotsLeft()) return res.status(503).send({ error: 'Bot slots are full right now. Please try again later.' });
    try { res.send(await startSession({})); }
    catch (e) { fail(res, e); }
});

api.get('/status', (req, res) => {
    const id = String(req.query.id || '');
    if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).send({ status: 'error', error: 'Bad request.' });
    const job = readJob(id);
    if (!job) return res.status(404).send({ status: 'unknown', error: 'This request has expired. Please start again.' });
    res.send({ status: job.status, qr: job.qr, number: job.number, error: job.error });
});

app.use('/api', api);
app.use((req, res) => res.status(404).send('Not found'));

// Baileys throws harmless network errors now and then – log them, don't crash.
process.on('unhandledRejection', (e) => console.log('Unhandled rejection:', e?.message || e));
process.on('uncaughtException', (e) => console.log('Uncaught exception:', e?.message || e));

const server = app.listen(PORT, () => {
    console.log(`✅ Gideon web running on http://localhost:${PORT}`);
    manager.restoreAll().catch((e) => console.error('Could not restore saved bots:', e));
});

// Render sends SIGTERM before restarting/redeploying – save every login first.
let closing = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
        if (closing) return;
        closing = true;
        console.log(`${sig} received – saving bots…`);
        server.close();
        try { await manager.shutdown(); } catch (e) { console.error(e); }
        process.exit(0);
    });
}
