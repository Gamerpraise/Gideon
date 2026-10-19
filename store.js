// Jobs (so the web page can pick up the finished session), rate limiting and the sessions counter.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/* ---------------- jobs ---------------- */
const jobs = new Map();
const JOB_TTL = 15 * 60 * 1000;

export function createJob() {
    const id = crypto.randomBytes(16).toString('hex');
    jobs.set(id, { status: 'waiting', createdAt: Date.now() });
    return id;
}

export function updateJob(id, patch) {
    const job = jobs.get(id);
    if (job) Object.assign(job, patch);
}

// The finished session is handed to the page ONCE and then forgotten by the server.
export function readJob(id) {
    const job = jobs.get(id);
    if (!job) return null;
    const copy = { ...job };
    if (['ready', 'error', 'expired'].includes(job.status)) jobs.delete(id);
    return copy;
}

setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) if (now - job.createdAt > JOB_TTL) jobs.delete(id);
}, 60_000).unref();

/* ---------------- rate limit (per IP) ---------------- */
const hits = new Map();
export function rateLimit(max = 8, windowMs = 10 * 60 * 1000) {
    return (req, res, next) => {
        const now = Date.now();
        const list = (hits.get(req.ip) || []).filter(t => now - t < windowMs);
        if (list.length >= max) {
            return res.status(429).send({ error: 'Too many attempts. Please wait a few minutes and try again.' });
        }
        list.push(now);
        hits.set(req.ip, list);
        next();
    };
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of hits) if (!list.some(t => now - t < 10 * 60 * 1000)) hits.delete(ip);
}, 5 * 60 * 1000).unref();

/* ---------------- counter ---------------- */
const COUNTER_FILE = path.resolve(process.env.COUNTER_FILE || './counter.json');
let total = 0;
try { total = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).total || 0; } catch { /* first run */ }

export const getTotal = () => total;

export function bumpTotal() {
    total++;
    try {
        fs.writeFileSync(COUNTER_FILE + '.tmp', JSON.stringify({ total }));
        fs.renameSync(COUNTER_FILE + '.tmp', COUNTER_FILE);
    } catch (e) {
        console.error('Could not save counter:', e.message);
    }
}
