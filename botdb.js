// A tiny JSON database. Every hosted bot gets its OWN one (settings, per-group settings, bans).
import fs from 'fs';
import config from './config.js';

const defaultsFor = () => ({
    settings: {
        prefix: config.prefix,
        mode: config.mode,
        autoread: false,
        autotyping: false,
        autoviewstatus: false,
        alwaysonline: false,
        anticall: false,
        antidelete: false
    },
    groups: {},
    banned: [],
    welcomed: false
});

export function createDb(file) {
    const defaults = defaultsFor();
    let data = defaults;
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        data = { ...defaults, ...saved, settings: { ...defaults.settings, ...(saved.settings || {}) } };
    } catch { /* first run */ }

    let timer = null;
    const db = {
        data,
        flush() {
            clearTimeout(timer);
            try {
                fs.writeFileSync(file + '.tmp', JSON.stringify(db.data, null, 2));
                fs.renameSync(file + '.tmp', file);
            } catch (e) {
                console.error('DB save failed:', e.message);
            }
        },
        save() {
            clearTimeout(timer);
            timer = setTimeout(db.flush, 800);
        },
        group(jid) {
            if (!db.data.groups[jid]) {
                db.data.groups[jid] = { antilink: 'off', welcome: false, goodbye: false, welcomeText: '', goodbyeText: '', warns: {} };
            }
            return db.data.groups[jid];
        }
    };
    return db;
}
