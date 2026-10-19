// Runs after `npm install`. Safe: does nothing if the line isn't found, never fails the install.
//
// Why: WhatsApp started rejecting the "WEB" platform value that Baileys sends when it
// registers a new linked device (pairing never completes / 405). Reported fix = send MACOS.
// Disable with SKIP_BAILEYS_PATCH=1.
import fs from 'fs';
import path from 'path';

try {
    if (process.env.SKIP_BAILEYS_PATCH) process.exit(0);
    const base = path.resolve('node_modules/@whiskeysockets/baileys/lib/Utils');
    for (const name of ['validate-connection.js', 'validate-connection.cjs']) {
        const file = path.join(base, name);
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, 'utf8');
        const out = src.replace(/UserAgent\.Platform\.WEB(?![A-Z_])/g, 'UserAgent.Platform.MACOS');
        if (out !== src) {
            fs.writeFileSync(file, out);
            console.log(`[patch] ${name}: Platform.WEB -> Platform.MACOS`);
        } else {
            console.log(`[patch] ${name}: nothing to patch`);
        }
    }
} catch (e) {
    console.log('[patch] skipped:', e.message);
}
process.exit(0);
