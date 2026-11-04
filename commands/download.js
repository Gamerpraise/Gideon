const yts = require('yt-search')
const fn = require('../functions')

module.exports = [
  {
    name: 'play',
    aliases: ['song', 'ytmp3'],
    desc: 'Download YouTube audio',
    category: 'download',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .play faded alan walker')
      await m.reply('Searching...')
      const search = await yts(text)
      const video = search.videos[0]
      if (!video) return m.reply('No result found.')
      try {
        const media = await fn.ytdl(video.url, 'audio')
        await sock.sendMessage(m.chat, {
          audio: { url: media.url },
          mimetype: 'audio/mpeg',
          fileName: `${media.title || video.title}.mp3`,
          contextInfo: {
            externalAdReply: {
              title: media.title || video.title,
              body: video.author?.name || 'YouTube',
              thumbnailUrl: video.thumbnail,
              sourceUrl: video.url,
              mediaType: 1
            }
          }
        }, { quoted: { key: m.key, message: m.message } })
      } catch (err) {
        await m.reply(err.message)
      }
    }
  },
  {
    name: 'ytmp4',
    aliases: ['video', 'ytv'],
    desc: 'Download YouTube video',
    category: 'download',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .ytmp4 https://youtu.be/xxxx')
      await m.reply('Downloading...')
      try {
        const query = fn.isUrl(text) ? text : (await yts(text)).videos[0]?.url
        if (!query) return m.reply('No result found.')
        const media = await fn.ytdl(query, 'video')
        await sock.sendMessage(m.chat, {
          video: { url: media.url },
          caption: media.title || 'YouTube video',
          mimetype: 'video/mp4'
        }, { quoted: { key: m.key, message: m.message } })
      } catch (err) {
        await m.reply(err.message)
      }
    }
  },
  {
    name: 'yts',
    aliases: ['ytsearch'],
    desc: 'Search YouTube',
    category: 'search',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .yts alan walker')
      const search = await yts(text)
      const list = search.videos.slice(0, 8)
      if (!list.length) return m.reply('No result found.')
      const body = list.map((v, i) => `${i + 1}. ${v.title}\n${v.timestamp} | ${v.url}`).join('\n\n')
      await m.reply(`*YouTube Search*\n\n${body}`)
    }
  },
  {
    name: 'tiktok',
    aliases: ['tt', 'ttdl'],
    desc: 'Download TikTok video',
    category: 'download',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .tiktok https://vt.tiktok.com/xxxx')
      try {
        const media = await fn.tiktokDl(text)
        await sock.sendMessage(m.chat, { video: { url: media.url }, caption: media.title }, { quoted: { key: m.key, message: m.message } })
      } catch (err) {
        await m.reply(err.message)
      }
    }
  },
  {
    name: 'ig',
    aliases: ['igdl', 'instagram'],
    desc: 'Download Instagram media',
    category: 'download',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .ig https://www.instagram.com/p/xxxx')
      try {
        const list = await fn.instaDl(text)
        for (const item of list.slice(0, 5)) {
          const url = item.url || item.download || item
          const isVideo = /mp4|video/i.test(item.type || url)
          if (isVideo) await sock.sendMessage(m.chat, { video: { url } })
          else await sock.sendMessage(m.chat, { image: { url } })
        }
      } catch (err) {
        await m.reply(err.message)
      }
    }
  },
  {
    name: 'fb',
    aliases: ['facebook', 'fbdl'],
    desc: 'Download Facebook video',
    category: 'download',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .fb https://fb.watch/xxxx')
      try {
        const data = await fn.fetchJson(`https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(text)}`)
        const url = data.result?.url || data.data?.url || data.url
        if (!url) return m.reply('Unable to download that Facebook video.')
        await sock.sendMessage(m.chat, { video: { url }, caption: 'Facebook download' })
      } catch {
        await m.reply('Unable to download that Facebook video.')
      }
    }
  },
  {
    name: 'mediafire',
    aliases: ['mf'],
    desc: 'Download MediaFire file',
    category: 'download',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .mediafire https://www.mediafire.com/file/xxxx')
      try {
        const data = await fn.fetchJson(`https://api.siputzx.my.id/api/d/mediafire?url=${encodeURIComponent(text)}`)
        const result = data.result || data.data || data
        if (!result.url && !result.download) return m.reply('Unable to fetch that file.')
        await m.reply(`*MediaFire*\nName: ${result.filename || result.name}\nSize: ${result.size || '-'}\nLink: ${result.url || result.download}`)
      } catch {
        await m.reply('Unable to fetch that MediaFire file.')
      }
    }
  },
  {
    name: 'gitclone',
    aliases: ['git'],
    desc: 'Download a GitHub repo as zip',
    category: 'download',
    async run(sock, m, { text }) {
      const match = (text || '').match(/github\.com\/([^/]+)\/([^/#?]+)/i)
      if (!match) return m.reply('Example: .gitclone https://github.com/user/repo')
      const url = `https://api.github.com/repos/${match[1]}/${match[2]}/zipball`
      await sock.sendMessage(m.chat, {
        document: { url },
        mimetype: 'application/zip',
        fileName: `${match[2]}.zip`
      })
    }
  }
]
