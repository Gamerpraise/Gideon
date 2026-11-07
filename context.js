// Per-user context for Gideon Cloud. Every Cloud bot is the main bot of its own owner, so the settings its owner changes
// (prefix, theme, auto-read, bans, antilink, ...) must never touch the host or other users. Code that runs for a Cloud bot
// (its WhatsApp events, and everything those start) runs inside this context: store.get() then returns that user's own
// database and config.prefix / config.autoRead / ... return that user's own values. Outside it, nothing changes.
const { AsyncLocalStorage } = require('async_hooks')

const als = new AsyncLocalStorage()
const ctxs = new Map()

// the context of one Cloud bot (created on first use, loads that user's saved settings)
als.forBot = (id) => {
  let c = ctxs.get(id)
  if (!c) {
    const store = require('./store').bot(id)
    const cfg = { ...(store.data.settings || {}) }
    if (store.data.prefix) cfg.prefix = store.data.prefix
    c = { id, store, config: cfg }
    ctxs.set(id, c)
  }
  return c
}
als.all = () => [...ctxs.values()]
// the Cloud bot is gone: forget its context and database
als.drop = (id) => {
  ctxs.delete(id)
  require('./store').dropBot(id)
}

module.exports = als
