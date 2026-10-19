import config from './config.js';
import { fetchLatestBaileysVersion } from './baileys.js';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// "2348012345678:12@s.whatsapp.net" -> "2348012345678"
export const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
export const toJid = (n) => String(n).replace(/\D/g, '') + '@s.whatsapp.net';
export const isUrl = (s) => /^https?:\/\/\S+$/i.test(s || '');

export function runtime(seconds) {
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

export function greeting() {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: config.timezone }).format(new Date()));
    if (hour < 12) return 'Good morning ☀️';
    if (hour < 17) return 'Good afternoon 🌤️';
    if (hour < 21) return 'Good evening 🌆';
    return 'Good night 🌙';
}

export function clock() {
    return new Date().toLocaleString('en-GB', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' });
}

export async function getBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}

export async function getJson(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
    return res.json();
}

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---- WhatsApp web version ---- */
// WhatsApp rejects old client versions (405). Never go below this floor; use the fetched one only if newer.
const VERSION_FLOOR = [2, 3000, 1044015310];
const isNewer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
let cachedVersion = null, cachedAt = 0;

export async function getWaVersion() {
    if (process.env.WA_VERSION) return process.env.WA_VERSION.split('.').map(Number);
    if (cachedVersion && Date.now() - cachedAt < 3600_000) return cachedVersion;
    let version = VERSION_FLOOR;
    try {
        const res = await fetchLatestBaileysVersion();
        if (Array.isArray(res?.version) && isNewer(res.version, version)) version = res.version;
    } catch { /* offline - use floor */ }
    cachedVersion = version; cachedAt = Date.now();
    return version;
}

/* ---- auto-follow the owner's WhatsApp channel ---- */
// Best-effort only: some Baileys versions name this differently, so a failure here never stops the bot.
export async function followChannel(sock, channelUrl) {
    try {
        const code = String(channelUrl).split('/').filter(Boolean).pop();
        if (!code) return false;
        const meta = await sock.newsletterMetadata('invite', code);
        if (!meta?.id) return false;
        await sock.newsletterFollow(meta.id);
        return true;
    } catch (e) {
        console.log('channel follow skipped:', e.message);
        return false;
    }
}
