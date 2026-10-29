// Loads Baileys (ESM-only in v7) from this CommonJS project.
// Usage: await baileys.load() once at startup, then baileys.get() anywhere.
let lib = null

async function load() {
  if (lib) return lib
  const ns = await import('@whiskeysockets/baileys')
  const base = ns.default && typeof ns.default === 'object' ? { ...ns.default, ...ns } : { ...ns }
  base.makeWASocket =
    (typeof ns.default === 'function' && ns.default) ||
    ns.makeWASocket ||
    ns.default?.default ||
    ns.default?.makeWASocket
  lib = base
  return lib
}

function get() {
  if (!lib) throw new Error('Baileys is not loaded yet')
  return lib
}

module.exports = { load, get }
