export default {
    name: 'githubuser',
    aliases: ['ghuser', 'gh'],
    description: 'Look up a GitHub profile',
    usage: 'githubuser Gamerpraise',
    cooldown: 5,
    async run({ send, args, reply, raw }) {
        const user = args[0];
        if (!user) return reply('🐙 Example: *githubuser Gamerpraise*');
        const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}`, { headers: { 'User-Agent': 'Gideon-Bot' } });
        if (!res.ok) return reply('❌ GitHub user not found.');
        const u = await res.json();
        const caption =
`🐙 *${u.name || u.login}* (@${u.login})

📝 ${u.bio || 'No bio'}
📦 Repos: ${u.public_repos}
👥 Followers: ${u.followers} • Following: ${u.following}
📍 ${u.location || 'Unknown'}
🔗 ${u.html_url}`;
        await send({ image: { url: u.avatar_url }, caption }, { quoted: raw });
    }
};
