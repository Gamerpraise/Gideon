// Reads a `Gideon~` Session ID (the text from the pairing site) and returns { text, number }: the creds.json
// content and the WhatsApp number it belongs to. Throws when it cannot be read. Never log the input or output.
const zlib = require('zlib')

function decodeSession(input) {
  const raw = String(input || '').trim()
  if (!/^Gideon~/.test(raw) || raw.length > 400000) throw new Error('bad')
  const body = raw.slice('Gideon~'.length).trim()
  const tries = []
  if (body.startsWith('{')) tries.push(Buffer.from(body, 'utf8'))
  for (const enc of ['base64', 'base64url']) {
    try { tries.push(Buffer.from(body, enc)) } catch {}
  }
  for (let buf of tries) {
    try {
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 5e6 })
      const text = buf.toString('utf8')
      const creds = JSON.parse(text)
      const me = String(creds?.me?.id || '')
      const number = me.split(':')[0].split('@')[0].replace(/\D/g, '')
      if (creds && typeof creds === 'object' && creds.noiseKey && creds.signedIdentityKey && number.length >= 8) return { text, number }
    } catch {}
  }
  throw new Error('This Session ID could not be read. Generate a new one with the pair code button and paste the whole thing.')
}

module.exports = { decodeSession }
