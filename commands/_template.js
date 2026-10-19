// ╔══════════════════════════════════════════════════════════════╗
// ║  HOW TO ADD A COMMAND                                        ║
// ║  1. Copy this file into a folder inside /commands            ║
// ║     (the folder name becomes the menu category)              ║
// ║  2. Rename it (it must NOT start with "_") and edit it       ║
// ║  3. Restart the bot, or send  .reload  (owner only)          ║
// ╚══════════════════════════════════════════════════════════════╝
export default {
    name: 'hello',                 // used as  .hello
    aliases: ['hi', 'hey'],        // other names (optional)
    description: 'Say hello',      // shown in .help hello
    usage: 'hello [name]',         // shown in .help hello (prefix is added for you)
    // category: 'fun',            // optional - defaults to the folder name

    // ---- optional rules (delete the ones you don't need) ----
    owner: false,                  // only the bot owner
    group: false,                  // only in groups
    private: false,                // only in private chat
    admin: false,                  // only group admins
    botAdmin: false,               // bot must be a group admin
    cooldown: 3,                   // seconds between uses per person

    // ---- what the command does ----
    // Everything you can use is on ctx. The most useful:
    //   sock, m, chat, sender, isGroup, isOwner, isAdmin, isBotAdmin
    //   args (array), text (everything after the command), prefix
    //   quoted (the replied-to message), target / targets (mentioned users)
    //   reply(text), react(emoji), send(content), config, db, utils
    async run({ args, text, reply, react, m, config }) {
        await react('👋');
        const name = text || m.pushName || 'friend';
        await reply(`Hello ${name}! I am ${config.botName}.`);
    }
};
