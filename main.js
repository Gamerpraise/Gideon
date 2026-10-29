// The bot itself. Start it with `node index.js` (index.js restarts this file when needed).
const { boot } = require('./bot')

process.on('uncaughtException', (err) => console.error('[uncaught]', err))
process.on('unhandledRejection', (err) => console.error('[unhandled]', err))

boot()
