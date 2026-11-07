// Gideon AI: asks several providers one after another until one answers, so one dead free API never breaks .gideonai.
//   1. Google Gemini      - only if GEMINI_API_KEY is set (free key from aistudio.google.com); GEMINI_MODEL overrides the model
//   2. Pollinations text  - free, no key
//   3. siputzx            - free, no key (the old one)
// Everything times out (25s) instead of hanging. Returns null when nobody answered.
const SYSTEM = 'You are Gideon, a WhatsApp assistant by Gpraise. Answer accurately and concisely (a few short paragraphs at most), in the language of the question. Use plain text, no markdown tables.'
const TIMEOUT = 25000

async function getText(url, options = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...options })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.text()
}

const providers = [
  async (prompt) => {
    const key = process.env.GEMINI_API_KEY
    if (!key) return null
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    const raw = await getText(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] })
    })
    return JSON.parse(raw)?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('')
  },
  async (prompt) => getText(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai&system=${encodeURIComponent(SYSTEM)}`),
  async (prompt) => {
    const raw = await getText(`https://api.siputzx.my.id/api/ai/gpt3?prompt=${encodeURIComponent(SYSTEM)}&content=${encodeURIComponent(prompt)}`)
    let data = raw
    try { data = JSON.parse(raw) } catch {}
    const answer = data?.data || data?.result || data?.response || data
    return typeof answer === 'string' ? answer : null
  }
]

async function ask(query, context = '') {
  const prompt = context
    ? `Web search context:\n${context}\n\nQuestion: ${query}\n\nAnswer accurately and concisely, using the web context above when it is relevant.`
    : query
  for (const provider of providers) {
    try {
      const answer = await provider(prompt)
      if (typeof answer === 'string' && answer.trim() && !/^\s*[{<]/.test(answer)) return answer.trim()
    } catch {}
  }
  return null
}

module.exports = { ask, providers }
