export default {
    name: 'translate',
    aliases: ['tr', 'trt'],
    description: 'Translate text (reply to a message or type it)',
    usage: 'translate <language code> <text>   e.g. translate fr Good morning',
    cooldown: 3,
    async run({ args, quoted, reply, prefix }) {
        const lang = (args[0] || '').toLowerCase();
        const input = args.slice(1).join(' ') || quoted?.text;
        if (!/^[a-z]{2}(-[a-z]{2,4})?$/i.test(lang) || !input) {
            return reply(`🌍 Example:\n${prefix}translate fr Good morning\n(or reply to a message with ${prefix}translate yo)`);
        }
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(input)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('translator is busy, try again');
        const data = await res.json();
        const out = data[0].map(x => x[0]).join('');
        reply(`🌍 *Translation (${data[2] || 'auto'} → ${lang})*\n\n${out}`);
    }
};
