export default {
    name: 'tourl',
    aliases: ['upload', 'url'],
    description: 'Upload an image/video/file and get a link',
    usage: 'tourl (reply to media)',
    cooldown: 10,
    async run({ m, quoted, reply }) {
        const src = m.isMedia ? m : quoted?.isMedia ? quoted : null;
        if (!src) return reply('📎 Reply to an image, video, audio or file.');
        const buffer = await src.download();
        const ext = (src.mime.split('/')[1] || 'bin').split(';')[0];
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', new Blob([buffer]), `gideon.${ext}`);
        const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
        const link = (await res.text()).trim();
        if (!link.startsWith('http')) throw new Error('upload service said: ' + link.slice(0, 80));
        reply(`✅ *Uploaded*\n\n🔗 ${link}`);
    }
};
