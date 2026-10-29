const config = require('./config')

function box(text, title = config.botName || 'GIDEON') {
  const body = String(text ?? '').replace(/\r/g, '').replace(/\s+$/g, '')
  if (!body) return body
  if (body.startsWith('╭── •')) return body

  const header = `╭── • ${String(title).toUpperCase()} • ──╮`
  const lines = body.split('\n').map((line) => (line.length ? `│${line.startsWith(' ') ? line : ` ${line}`}` : '│'))
  return `${header}\n${lines.join('\n')}\n╰───────────────╯`
}

function styledContent(content) {
  if (!content || typeof content !== 'object') return content
  if (content.react || content.delete || content.contacts || content.poll) return content
  const next = { ...content }
  if (typeof next.text === 'string') next.text = box(next.text)
  if (typeof next.caption === 'string' && next.caption.trim()) next.caption = box(next.caption)
  return next
}

function contentToMessage(content) {
  if (!content || typeof content !== 'object') return undefined
  if (content.text) {
    return {
      extendedTextMessage: {
        text: content.text
      }
    }
  }
  if (content.caption && content.image) {
    return {
      imageMessage: { caption: content.caption }
    }
  }
  if (content.caption && content.video) {
    return {
      videoMessage: { caption: content.caption }
    }
  }
  if (content.conversation) return { conversation: content.conversation }
  return undefined
}

module.exports = { box, styledContent, contentToMessage }
