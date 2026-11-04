// Regenerates the command registry (name, aliases, description, class, default tier, policy status).
// Run after adding/removing a command file:   node scripts/gen-registry.js
// Output goes to:
//   commandpolicy.default.json                          (the bot's offline fallback)
//   Global-Gideon-server-main/platform/registry.json    (what the admin Command Manager lists)
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const dir = path.join(root, 'commands')

// ---- classification -------------------------------------------------------------------------
// class: management (A) | economy (B) | fun (C) | advanced (D) | utility (free, outside the four named groups)
const PREMIUM = {
  // user-named candidates
  anticall: 'Rejects/blocks callers automatically (account-level automation)',
  autostatus: 'Automatically views every contact status',
  statusreact: 'Automatically reacts to every contact status (automation, ban-risk)',
  autosavestatus: 'Automatically copies contacts\' statuses to your DM',
  savestatus: 'Saves a status you can already see to your DM',
  autoreply: 'Automated replies to incoming chats',
  replies: 'Part of the auto-reply system', reloadreply: 'Part of the auto-reply system', replytest: 'Part of the auto-reply system',
  // AI
  gideonai: 'AI command', imagine: 'AI image generation',
  // advanced media
  hd: 'Advanced media tool (image enhance)', removebg: 'Advanced media tool (background removal)',
  // advanced automation
  autobio: 'Scheduled bio updates', ghost: 'Changes the linked account\'s WhatsApp privacy settings in bulk',
  poststatus: 'Posts a status on main + every paired account', postpairstatus: 'Posts a status on paired accounts', delpost: 'Deletes posted statuses',
  gcstatus: 'Posts a status into a group chat (advanced)'
}
// Restricted = the feature works by defeating a privacy control the other person chose. Shipped DISABLED,
// cannot be switched on or sold as Premium from the dashboard. Source code is left untouched.
const RESTRICTED = {
  vv: 'Re-posts someone else\'s view-once media, defeating the sender\'s one-view choice',
  vv2: 'Silently copies someone else\'s view-once media to your DM and deletes your command message to hide it',
  antidelete: 'Forwards messages other people deleted for everyone to your DM, defeating their deletion'
}
// risk notes for commands that stay enabled but deserve a warning in the report
const WATCH = {
  autostatus: 'medium: mass automated status reads', statusreact: 'medium: mass automated reactions are a known ban trigger',
  autosavestatus: 'medium: bulk copying of contacts\' content', savestatus: 'low: you can already see this status',
  autoreply: 'medium: unsolicited automated messaging can be flagged as spam', anticall: 'low: blocks callers; own account',
  ghost: 'low: only changes your own privacy settings', poststatus: 'low', gcstatus: 'low', add: 'medium: adding people to groups in bulk can be flagged',
  kickall: 'high-impact: mass removal, owner/admin only', broadcast: 'high: bulk messaging is the most common cause of bans',
  everyone: 'low', approveall: 'low', vcf: 'medium: exports member phone numbers', nowa: 'medium: checks whether numbers are on WhatsApp (mass use is flagged)',
  getsession: 'high: exposes the session credentials, owner only + dangerous', eval: 'high: arbitrary code execution, owner only + dangerous', exec: 'high: arbitrary shell execution, owner only + dangerous',
  block: 'low', reactall: 'high: mass reactions across accounts', joinall: 'high: mass group/channel joins across accounts', notify: 'low: developer broadcast to owners'
}
const MANAGEMENT_EXTRA = new Set(['block', 'unblock', 'poll', 'tagadmins', 'warn', 'warnings', 'resetwarn', 'levelup', 'delete', 'react', 'everyone', 'afk'])

function classify(m) {
  const n = m.name
  const cat = (m.category || '').toLowerCase()
  if (RESTRICTED[n]) return 'advanced'
  if (PREMIUM[n]) return 'advanced'
  if (cat === 'local economy' || cat === 'global economy') return 'economy'
  if (n === 'rank' || n === 'top') return 'fun'
  if (cat === 'fun') return 'fun'
  if (cat === 'group' || MANAGEMENT_EXTRA.has(n)) return 'management'
  return 'utility'
}

function load() {
  const out = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    let mod
    try { mod = require(path.join(dir, f)) } catch (e) { console.error('skip', f, e.message); continue }
    for (const m of Array.isArray(mod) ? mod : [mod]) if (m && m.name) out.push({ file: f, m })
  }
  return out
}

const rows = {}
const dupes = []
const aliasOwner = {}
const aliasConflicts = []
for (const { file, m } of load()) {
  const n = m.name.toLowerCase()
  if (rows[n]) dupes.push({ name: n, files: [rows[n].file, file] })
  for (const a of [n, ...(m.aliases || [])].map((x) => String(x).toLowerCase())) {
    if (aliasOwner[a] && aliasOwner[a] !== n) aliasConflicts.push({ alias: a, commands: [aliasOwner[a], n] })
    aliasOwner[a] = n
  }
  const cls = classify(m)
  const restricted = !!RESTRICTED[n]
  rows[n] = {
    name: n,
    aliases: (m.aliases || []).map(String),
    desc: m.desc || '',
    originalCategory: m.category || 'general',
    class: cls,
    defaultTier: restricted ? 'RESTRICTED' : PREMIUM[n] ? 'PREMIUM' : 'FREE',
    defaultEnabled: !restricted,
    policy: restricted ? 'restricted' : WATCH[n] ? 'watch' : 'ok',
    policyNote: restricted ? RESTRICTED[n] : WATCH[n] || '',
    premiumReason: PREMIUM[n] || '',
    owner: !!m.owner,
    group: !!m.group,
    admin: !!m.admin,
    dangerous: !!m.dangerous,
    file
  }
}
const list = Object.values(rows).sort((a, b) => a.name.localeCompare(b.name))
const registry = { generatedAt: new Date().toISOString(), count: list.length, duplicates: dupes, aliasConflicts, commands: list }

fs.writeFileSync(path.join(root, 'commandpolicy.default.json'), JSON.stringify(registry))
const srv = path.join(root, 'Global-Gideon-server-main', 'platform')
fs.mkdirSync(srv, { recursive: true })
fs.writeFileSync(path.join(srv, 'registry.json'), JSON.stringify(registry, null, 1))

const by = {}
list.forEach((c) => { by[c.defaultTier + '/' + c.class] = (by[c.defaultTier + '/' + c.class] || 0) + 1 })
console.log('commands:', list.length, by)
console.log('duplicate names:', JSON.stringify(dupes))
console.log('alias conflicts:', JSON.stringify(aliasConflicts))
