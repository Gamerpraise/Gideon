// Thin client for the shared Gideon Network server (see network-server/). Every call is a
// plain HTTP request; nothing here touches Firestore directly, the server does all the real
// decision-making. A bot only reaches this at all once its owner has run .joinnetwork on.
const axios = require('axios')
const crypto = require('crypto')
const config = require('./config')

function configured() {
  return Boolean(config.networkApiUrl && config.networkKey)
}

function client() {
  return axios.create({
    baseURL: config.networkApiUrl,
    timeout: 15000,
    headers: { 'x-network-key': config.networkKey }
  })
}

// Wraps every call: network errors, a sleeping free-tier server waking up, and the server's
// own JSON error codes all come back the same simple shape so commands don't need try/catch.
async function call(method, path, data) {
  if (!configured()) return { ok: false, error: 'NOT_CONFIGURED' }
  try {
    // Every economy write carries a one-off idempotency key, so a request that is repeated (timeout, retry,
    // double tap) is applied by the server only once. The server replays the stored answer instead.
    const headers = method === 'post' && !/^\/(install|premium|policy)/.test(path) ? { 'x-idempotency-key': crypto.randomBytes(16).toString('hex') } : undefined
    const res = await client().request({ method, url: path, data, headers })
    return { ok: true, ...res.data }
  } catch (err) {
    if (err.code === 'ECONNABORTED') return { ok: false, error: 'TIMEOUT' }
    const body = err.response?.data
    // 404 = the shared server is running an older version that doesn't have this endpoint yet
    if (err.response?.status === 404 && !body?.error) return { ok: false, error: 'NOT_SUPPORTED', status: 404 }
    return { ok: false, error: body?.error || 'UNREACHABLE', wait: body?.wait, status: err.response?.status }
  }
}

// Platform layer: policy, installation identity, Premium (see premium.js)
const policy = () => call('get', '/policy')
const registerInstall = (body) => call('post', '/install/register', body)
const premiumAuthorize = (installId, token, command) => call('post', '/premium/authorize', { installId, token, command })
const premiumStatus = (installId, token) => call('post', '/premium/status', { installId, token })
const premiumClaim = (installId, token, ownerNumber, premiumId) => call('post', '/premium/claim', { installId, token, ownerNumber, premiumId })
const premiumRelease = (installId, token) => call('post', '/premium/release', { installId, token })
const premiumCheckout = (installId, token, plan, email) => call('post', '/premium/checkout', { installId, token, plan, email })
const premiumPayment = (installId, token, reference) => call('post', '/premium/payment', { installId, token, reference })

const join = (number) => call('post', '/join', { number })
const leave = (number) => call('post', '/leave', { number })
const balance = (number) => call('get', `/balance/${number}`)
const send = (from, to, amount) => call('post', '/send', { from, to, amount })
const rob = (from, to) => call('post', '/rob', { from, to })
const richest = (limit = 10) => call('get', `/richest?limit=${limit}`)
const poorest = () => call('get', '/poorest')
const work = (number) => call('post', '/work', { number })
const bank = (number) => call('get', `/bank/${number}`)
const deposit = (number, amount) => call('post', '/deposit', { number, amount })
const withdraw = (number, amount) => call('post', '/withdraw', { number, amount })

// The rest of the ported local economy (see network-server/economy.js)
const state = (number) => call('get', `/state/${number}`)
const loan = (number, amount) => call('post', '/loan', { number, amount })
const payloan = (number, amount) => call('post', '/payloan', { number, amount })
const itemBuy = (number, item) => call('post', '/item/buy', { number, item })
const itemSell = (number, item) => call('post', '/item/sell', { number, item })
const itemUse = (number, item) => call('post', '/item/use', { number, item })
const setJob = (number, job) => call('post', '/job', { number, job })
const jailList = (limit = 25) => call('get', `/jail?limit=${limit}`)
const bail = (number, target) => call('post', '/bail', { number, target })
const steal = (number, target) => call('post', '/steal', { number, target })
const scam = (number, target) => call('post', '/scam', { number, target })
const cryptoMarket = () => call('get', '/crypto')
const cryptoTrade = (number, side, units) => call('post', '/crypto/trade', { number, side, units })
const invest = (number, amount) => call('post', '/invest', { number, amount })
const investClaim = (number) => call('post', '/invest/claim', { number })
const bizBuy = (number, type) => call('post', '/business/buy', { number, type })
const bizCollect = (number, type) => call('post', '/business/collect', { number, type })
const bizUpgrade = (number, type) => call('post', '/business/upgrade', { number, type })
const bizSell = (number, type) => call('post', '/business/sell', { number, type })

// Stateless gambling (the server rolls the dice/cards/wheel, same balance-changing transaction)
const gamble = (number, bet) => call('post', '/gamble', { number, bet })
const slots = (number) => call('post', '/slots', { number })
const roulette = (number, color, bet) => call('post', '/roulette', { number, color, bet })
const dicebet = (number, bet, guess) => call('post', '/dicebet', { number, bet, guess })
const coinflip = (number, side, bet) => call('post', '/coinflip', { number, side, bet })


// Earning / activity commands ported from the local economy. The server owns the cooldowns,
// payouts and jail checks (see Global-Gideon-server-main/economy.js).
const earn = (number, action) => call('post', '/earn', { number, action })
const tradeOffer = (number, target, item, price) => call('post', '/trade/offer', { number, target, item, price })
const tradeRespond = (number, accept) => call('post', '/trade/respond', { number, accept })
const heist = (numbers) => call('post', '/heist', { numbers })
const police = (number, chat) => call('post', '/police', { number, chat })
const bjStart = (number, bet) => call('post', '/blackjack/start', { number, bet })
const bjHit = (number) => call('post', '/blackjack/hit', { number })
const bjStand = (number) => call('post', '/blackjack/stand', { number })
const lotteryBuy = (number, tickets) => call('post', '/lottery/buy', { number, tickets })
const lotteryInfo = (number) => call('get', `/lottery/info?number=${number}`)

// Census / dev fan-out helpers
const checkin = (id, accounts) => call('post', '/checkin', { id, accounts })

// The developer command queue (.joinall/.reactall fan-out, see .allowdev). pushDevCommand
// needs the separate, private devPushKey - only ever set in the real developer's own
// config.local.json, never in the public repo. pollDevCommands just needs the ordinary
// public key, since reading the queue can't be used to tamper with anything.
function devConfigured() {
  return Boolean(config.networkApiUrl && config.networkKey && config.devPushKey)
}

async function pushDevCommand(payload) {
  if (!devConfigured()) return { ok: false, error: 'NOT_CONFIGURED' }
  try {
    const res = await axios.post(`${config.networkApiUrl}/dev/push`, payload, {
      timeout: 15000,
      headers: { 'x-network-key': config.networkKey, 'x-dev-key': config.devPushKey }
    })
    return { ok: true, ...res.data }
  } catch (err) {
    return { ok: false, error: err.response?.data?.error || 'UNREACHABLE' }
  }
}

const pollDevCommands = (since) => call('get', `/dev/pending?since=${since || 0}`)

async function devBotcount() {
  if (!devConfigured()) return { ok: false, error: 'NOT_CONFIGURED' }
  try {
    const res = await axios.get(`${config.networkApiUrl}/dev/botcount`, { timeout: 15000, headers: { 'x-network-key': config.networkKey, 'x-dev-key': config.devPushKey } })
    return { ok: true, ...res.data }
  } catch (err) {
    return { ok: false, error: err.response?.data?.error || 'UNREACHABLE' }
  }
}

module.exports = {
  configured,
  call,
  policy,
  registerInstall,
  premiumAuthorize,
  premiumStatus,
  premiumClaim,
  premiumRelease,
  premiumCheckout,
  premiumPayment,
  join,
  leave,
  balance,
  send,
  rob,
  richest,
  poorest,
  work,
  bank,
  deposit,
  withdraw,
  state,
  loan,
  payloan,
  itemBuy,
  itemSell,
  itemUse,
  setJob,
  jailList,
  bail,
  steal,
  scam,
  cryptoMarket,
  cryptoTrade,
  invest,
  investClaim,
  bizBuy,
  bizCollect,
  bizUpgrade,
  bizSell,
  gamble,
  slots,
  roulette,
  dicebet,
  coinflip,
  earn,
  tradeOffer,
  tradeRespond,
  heist,
  police,
  bjStart,
  bjHit,
  bjStand,
  lotteryBuy,
  lotteryInfo,
  checkin,
  devConfigured,
  devBotcount,
  pushDevCommand,
  pollDevCommands
}
