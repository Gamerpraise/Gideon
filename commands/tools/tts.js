export default {
    name: 'tts',
    aliases: ['say', 'speak'],
    description: 'Turn text into a voice note',
    usage: 'tts [lang] <text>   e.g. tts en Hello world',
    cooldown: 5,
    async run({ send, args, text, quoted, reply, utils, raw }) {
        let lang = 'en';
        let words = text;
        if (args.length > 1 && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(args[0])) {
            lang = args[0];
            words = args.slice(1).join(' ');
        }
        words = words || quoted?.text;
        if (!words) return reply('✏️ Type something to say.');
        if (words.length > 200) return reply('⚠️ Max 200 characters.');
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(words)}`;
        const audio = await utils.getBuffer(url);
        await send({ audio, mimetype: 'audio/mpeg', ptt: true }, { quoted: raw });
    }
};
