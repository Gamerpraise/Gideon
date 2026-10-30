const fs = require('fs')
const path = require('path')
const axios = require('axios')
const baileys = require('./baileys')
const FileType = require('file-type')
const config = require('./config')
const store = require('./store')
const { box } = require('./style')

function downloadContentFromMessage(...args) {
  return baileys.get().downloadContentFromMessage(...args)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runtime(seconds) {
  seconds = Number(seconds)
  const d = Math.floor(seconds / 86400)
  const h = Math.floor(seconds / 3600) % 24
  const m = Math.floor(seconds / 60) % 60
  const s = Math.floor(seconds % 60)
  return `${d}d ${h}h ${m}m ${s}s`
}

function clockString() {
  return new Date().toLocaleString('en-GB', { timeZone: config.timezone })
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function isUrl(text) {
  return /https?:\/\/[^\s]+/i.test(text || '')
}

function extractUrls(text) {
  return (text || '').match(/https?:\/\/[^\s]+/gi) || []
}

function cleanJid(jid = '') {
  return jid.replace(/:\d+/, '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function toJid(num) {
  return `${String(num).replace(/\D/g, '')}@s.whatsapp.net`
}

function isOwner(jid, extraOwners = []) {
  if (Array.isArray(jid)) return jid.some((j) => isOwner(j, extraOwners))
  const num = cleanJid(jid)
  const owners = new Set([
    config.ownerNumber.replace(/\D/g, ''),
    ...store.get().owners,
    ...extraOwners.map(cleanJid)
  ])
  return owners.has(num)
}

// The real owner only (config number), not the extra owners added with .addowner
function isMainOwner(jid) {
  if (Array.isArray(jid)) return jid.some((j) => isMainOwner(j))
  return cleanJid(jid) === config.ownerNumber.replace(/\D/g, '')
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

async function fetchJson(url, options = {}) {
  const res = await axios({ url, method: 'GET', timeout: 30000, ...options })
  return res.data
}

async function getBuffer(url, options = {}) {
  const res = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer',
    timeout: 60000,
    ...options
  })
  return Buffer.from(res.data)
}

async function downloadMediaMessage(quoted) {
  const msg = quoted.msg || quoted
  const type = quoted.mtype || Object.keys(msg)[0]
  const mimeType = type.replace('Message', '')
  const stream = await downloadContentFromMessage(msg, mimeType === 'sticker' ? 'sticker' : mimeType)
  let buffer = Buffer.from([])
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
  return buffer
}

function unwrapViewOnce(message) {
  if (!message) return null
  const wrapped =
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    (message.ephemeralMessage && unwrapViewOnce(message.ephemeralMessage.message)) ||
    null
  return wrapped || message
}

function getViewOnceContent(message) {
  const unwrapped = unwrapViewOnce(message)
  if (!unwrapped) return null
  if (unwrapped.imageMessage) return { type: 'image', content: unwrapped.imageMessage }
  if (unwrapped.videoMessage) return { type: 'video', content: unwrapped.videoMessage }
  if (unwrapped.audioMessage) return { type: 'audio', content: unwrapped.audioMessage }
  return null
}

function isViewOnceMessage(message) {
  if (!message) return false
  if (
    message.viewOnceMessage ||
    message.viewOnceMessageV2 ||
    message.viewOnceMessageV2Extension
  ) return true
  const unwrapped = unwrapViewOnce(message)
  return Boolean(
    unwrapped?.imageMessage?.viewOnce ||
    unwrapped?.videoMessage?.viewOnce ||
    unwrapped?.audioMessage?.viewOnce
  )
}

async function downloadViewOnce(message) {
  const media = getViewOnceContent(message)
  if (!media) return null
  const stream = await downloadContentFromMessage(media.content, media.type)
  let buffer = Buffer.from([])
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
  return {
    type: media.type,
    buffer,
    caption: media.content.caption || '',
    mimetype: media.content.mimetype,
    ptt: media.content.ptt || false
  }
}

// Download any media message (also unwraps view-once / ephemeral wrappers).
// Returns { type, buffer, caption, mimetype, ptt } or null when it has no downloadable media.
async function downloadAny(message, maxBytes = 40 * 1024 * 1024) {
  let msg = message
  for (let i = 0; i < 4 && msg; i++) {
    const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg.viewOnceMessageV2Extension?.message || msg.documentWithCaptionMessage?.message
    if (!inner) break
    msg = inner
  }
  if (!msg) return null
  for (const type of ['image', 'video', 'audio', 'sticker']) {
    const content = msg[`${type}Message`]
    if (!content) continue
    if (Number(content.fileLength || 0) > maxBytes) throw new Error('File is too large')
    const stream = await downloadContentFromMessage(content, type)
    let buffer = Buffer.from([])
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
    return { type, buffer, caption: content.caption || '', mimetype: content.mimetype, ptt: content.ptt || false }
  }
  return null
}

async function sendViewOnceMedia(sock, jid, media, quoted) {
  const payload = {}
  if (media.caption) payload.caption = media.caption
  if (media.type === 'image') payload.image = media.buffer
  else if (media.type === 'video') payload.video = media.buffer
  else {
    payload.audio = media.buffer
    payload.mimetype = media.mimetype || 'audio/ogg; codecs=opus'
    payload.ptt = media.ptt
  }
  return sock.sendMessage(jid, payload, quoted ? { quoted } : {})
}

async function getFileType(buffer) {
  return FileType.fromBuffer(buffer)
}

function parseMention(text = '') {
  return (text.match(/@(\d{5,16})/g) || []).map((v) => v.replace('@', '') + '@s.whatsapp.net')
}

// Every id (lid + phone) of every admin, so both addressing modes match.
async function getGroupAdmins(participants = []) {
  const ids = []
  for (const p of participants) {
    if (p.admin !== 'admin' && p.admin !== 'superadmin') continue
    ids.push(p.id, p.lid, p.phoneNumber, p.jid)
  }
  return [...new Set(ids.filter(Boolean))]
}

function sameUser(a, b) {
  return Boolean(a && b) && cleanJid(a) === cleanJid(b)
}

// ids can be one jid or an array of jids
function isInList(list = [], ids) {
  const wanted = Array.isArray(ids) ? ids : [ids]
  return list.some((entry) => wanted.some((id) => sameUser(entry, id)))
}

// Try to turn a @lid into a phone jid using Baileys' own LID map (v7).
const pnCache = new Map()
async function resolvePN(sock, jid) {
  try {
    if (!jid || !String(jid).endsWith('@lid')) return jid
    if (pnCache.has(jid)) return pnCache.get(jid)
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid)
    if (!pn) return jid
    const full = String(pn).includes('@') ? pn : `${pn}@s.whatsapp.net`
    if (pnCache.size > 5000) pnCache.clear()
    pnCache.set(jid, full)
    return full
  } catch {
    return jid
  }
}

function bytesToSize(bytes) {
  return formatSize(bytes)
}

function tmpFile(ext = 'bin') {
  const dir = path.join(__dirname, 'tmp')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`)
}

function saveTmp(buffer, ext) {
  const file = tmpFile(ext)
  fs.writeFileSync(file, buffer)
  return file
}

function deleteTmp(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file)
  } catch {}
}

async function ytdl(url, type = 'audio') {
  const apis = [
    `https://api.siputzx.my.id/api/d/ytmp${type === 'audio' ? '3' : '4'}?url=${encodeURIComponent(url)}`,
    `https://yt.tioo.eu.org/api/${type === 'audio' ? 'mp3' : 'mp4'}?url=${encodeURIComponent(url)}`,
    `https://api.fgmods.xyz/api/downloader/yt${type === 'audio' ? 'mp3' : 'mp4'}?url=${encodeURIComponent(url)}&apikey=fg-dylux`
  ]
  for (const api of apis) {
    try {
      const data = await fetchJson(api)
      const result = data.result || data.data || data
      const media = result.dl_url || result.url || result.download || result.dlink
      if (media) {
        return {
          title: result.title || 'YouTube media',
          url: media,
          thumbnail: result.thumbnail || result.thumb,
          quality: result.quality || ''
        }
      }
    } catch {}
  }
  throw new Error('Unable to download that YouTube media right now')
}

async function tiktokDl(url) {
  const apis = [
    `https://tikwm.com/api/?url=${encodeURIComponent(url)}`,
    `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`
  ]
  for (const api of apis) {
    try {
      const data = await fetchJson(api)
      const result = data.data || data.result || data
      const video = result.play || result.hdplay || result.url || result.video
      if (video) {
        return {
          title: result.title || 'TikTok video',
          url: video,
          audio: result.music || result.audio
        }
      }
    } catch {}
  }
  throw new Error('Unable to download that TikTok video')
}

async function instaDl(url) {
  const apis = [
    `https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(url)}`,
    `https://ig.tioo.eu.org/?url=${encodeURIComponent(url)}`
  ]
  for (const api of apis) {
    try {
      const data = await fetchJson(api)
      const result = data.result || data.data || data
      const list = Array.isArray(result) ? result : result.url ? [result] : result.media || []
      if (list.length) return list
    } catch {}
  }
  throw new Error('Unable to download that Instagram media')
}

module.exports = {
  sleep,
  runtime,
  clockString,
  pickRandom,
  isUrl,
  extractUrls,
  cleanJid,
  toJid,
  isOwner,
  isMainOwner,
  formatSize,
  fetchJson,
  getBuffer,
  downloadMediaMessage,
  unwrapViewOnce,
  getViewOnceContent,
  isViewOnceMessage,
  downloadViewOnce,
  downloadAny,
  sendViewOnceMedia,
  getFileType,
  parseMention,
  getGroupAdmins,
  sameUser,
  isInList,
  resolvePN,
  bytesToSize,
  tmpFile,
  saveTmp,
  deleteTmp,
  ytdl,
  tiktokDl,
  instaDl,
  box
}
