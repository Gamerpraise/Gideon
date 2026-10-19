// Finds every .js file inside /commands (any depth) and registers it.
// Files or folders starting with "_" are ignored (e.g. _template.js).
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve('commands');

export const registry = new Map(); // name or alias -> command
export const commandList = [];     // unique commands

function walk(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('_')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walk(full));
        else if (entry.name.endsWith('.js')) files.push(full);
    }
    return files;
}

export async function loadCommands() {
    registry.clear();
    commandList.length = 0;
    const errors = [];

    for (const file of walk(ROOT)) {
        const rel = path.relative(ROOT, file);
        try {
            // ?v= makes .reload pick up edited files
            const mod = await import(pathToFileURL(file).href + `?v=${Date.now()}`);
            const exported = mod.default;
            const cmds = Array.isArray(exported) ? exported : [exported];

            for (const cmd of cmds) {
                if (!cmd || typeof cmd.run !== 'function' || !cmd.name) {
                    errors.push(`${rel}: needs a "name" and a "run" function`);
                    continue;
                }
                cmd.name = String(cmd.name).toLowerCase();
                const folder = path.dirname(rel).split(path.sep)[0];
                cmd.category = String(cmd.category || (folder === '.' ? 'general' : folder)).toLowerCase();
                cmd.aliases = (cmd.aliases || []).map(a => String(a).toLowerCase());

                for (const key of [cmd.name, ...cmd.aliases]) {
                    if (registry.has(key)) errors.push(`${rel}: "${key}" is already used by another command`);
                    else registry.set(key, cmd);
                }
                commandList.push(cmd);
            }
        } catch (e) {
            errors.push(`${rel}: ${e.message}`);
        }
    }

    console.log(`📦 Loaded ${commandList.length} commands`);
    for (const e of errors) console.warn(`⚠️  ${e}`);
    return { count: commandList.length, errors };
}
