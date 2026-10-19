// One file, many commands: .autoread .autotyping .autoviewstatus .alwaysonline .anticall .antidelete
// To add another switch, add a line to the list (and use it somewhere in lib/).
const TOGGLES = [
    ['autoread', 'Mark incoming messages as read'],
    ['autotyping', 'Show "typing..." before replying'],
    ['autoviewstatus', 'Automatically view contacts\' statuses'],
    ['alwaysonline', 'Always show the bot as online'],
    ['anticall', 'Reject incoming calls'],
    ['antidelete', 'Send deleted messages to the bot chat']
];

export default TOGGLES.map(([key, desc]) => ({
    name: key,
    description: `${desc} (on/off)`,
    usage: `${key} on|off`,
    category: 'owner',
    owner: true,
    async run({ args, reply, db, prefix }) {
        const v = (args[0] || '').toLowerCase();
        if (v !== 'on' && v !== 'off') {
            return reply(`${desc}\nCurrently: *${db.data.settings[key] ? 'ON' : 'OFF'}*\nUse: ${prefix}${key} on|off`);
        }
        db.data.settings[key] = v === 'on';
        db.save();
        reply(`✅ *${key}* is now *${v.toUpperCase()}*`);
    }
}));
