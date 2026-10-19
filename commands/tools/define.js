export default {
    name: 'define',
    aliases: ['dictionary', 'meaning'],
    description: 'English dictionary',
    usage: 'define word',
    cooldown: 3,
    async run({ args, reply }) {
        const word = args[0];
        if (!word) return reply('📖 Example: *define serendipity*');
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        if (!res.ok) return reply(`❌ I could not find "${word}".`);
        const entry = (await res.json())[0];
        const out = [`📖 *${entry.word}* ${entry.phonetic || ''}`];
        for (const meaning of entry.meanings.slice(0, 3)) {
            const d = meaning.definitions[0];
            out.push(`\n_${meaning.partOfSpeech}_\n${d.definition}${d.example ? `\n💬 "${d.example}"` : ''}`);
        }
        reply(out.join('\n'));
    }
};
