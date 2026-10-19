// Optional encrypted backup of every hosted login to MongoDB.
// Why: free hosts (like Render) wipe the disk on every restart. With a backup, all bots come back by themselves.
// Needs MONGODB_URI + DATA_KEY. Logins are encrypted (AES-256-GCM) BEFORE they leave this server.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

let col = null;
let key = null;
const lastHash = new Map();

export const backupEnabled = () => !!col;

export async function initBackup() {
    const uri = process.env.MONGODB_URI;
    if (!uri) return false;
    if (!process.env.DATA_KEY || process.env.DATA_KEY.length < 12) {
        console.error('❌ MONGODB_URI is set but DATA_KEY is missing/too short (min 12 chars). Backup is OFF – logins must never be stored unencrypted.');
        return false;
    }
    try {
        const { MongoClient } = await import('mongodb');
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
        await client.connect();
        col = client.db(process.env.MONGODB_DB || 'gideon').collection('bots');
        key = crypto.createHash('sha256').update(process.env.DATA_KEY).digest();
        console.log('☁️  Encrypted backup is ON');
        return true;
    } catch (e) {
        console.error('❌ Could not connect to MongoDB – backup is OFF:', e.message);
        col = null;
        return false;
    }
}

function encrypt(obj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(p) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(p.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(p.tag, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(p.data, 'base64')), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
}

export function readDirFiles(dir) {
    const files = {};
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isFile()) files[name] = fs.readFileSync(full).toString('base64');
    }
    return files;
}

export function writeDirFiles(dir, files) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, b64] of Object.entries(files)) {
        if (name.includes('/') || name.includes('\\') || name.startsWith('.')) continue; // never trust names
        fs.writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));
    }
}

export async function saveBot(number, dir) {
    if (!col) return;
    const files = readDirFiles(dir);
    const hash = crypto.createHash('sha1').update(JSON.stringify(files)).digest('hex');
    if (lastHash.get(number) === hash) return; // nothing changed
    await col.updateOne({ _id: number }, { $set: { payload: encrypt(files), updatedAt: new Date() } }, { upsert: true });
    lastHash.set(number, hash);
}

export async function loadAll() {
    if (!col) return [];
    const out = [];
    for (const doc of await col.find({}).toArray()) {
        try {
            out.push({ number: String(doc._id), files: decrypt(doc.payload) });
        } catch {
            console.error(`⚠️ Could not decrypt backup for ${doc._id} (wrong DATA_KEY?) – skipped, not deleted.`);
        }
    }
    return out;
}

export async function deleteBot(number) {
    lastHash.delete(number);
    if (col) await col.deleteOne({ _id: number }).catch(() => {});
}
