# Gideon command classification report

Generated from the actual source (`node scripts/gen-registry.js`): **308 unique command names** across 35 files in `commands/`. Nothing was invented: every row below is a command that exists in your ZIP.

## Summary

| Class | FREE | PREMIUM | RESTRICTED |
|---|---|---|---|
| A. Free WhatsApp management | 46 | 0 | 0 |
| B. Free economy (local + global) | 103 | 0 | 0 |
| C. Free fun | 32 | 0 | 0 |
| D. Advanced (Premium candidates / restricted) | 0 | 19 | 3 |
| Other free utilities (not one of the four named groups; kept FREE so nothing is removed) | 105 | 0 | 0 |

All of this is only the **default**. In the Command Manager you can switch any non-restricted command between FREE and PREMIUM, or disable it, without touching code.

## Findings on the commands you asked me to look at

I read what each one actually does instead of judging by name.

| Command | What it really does | Verdict |
|---|---|---|
| `.antidelete` | Caches incoming messages and, when someone deletes one for everyone, forwards the original to the owner DM. | **RESTRICTED.** It defeats a deletion the other person chose. Shipped disabled, cannot be enabled or sold as Premium. |
| `.vv` | Downloads someone else's view-once media and re-posts it as normal media in the chat. | **RESTRICTED.** Defeats the sender's one-view choice. |
| `.vv2` | Same as vv, but sends it to your DM and deletes your own command message so nobody sees you did it. Its alias is literally `stealvv`. | **RESTRICTED.** Covert, deliberately hides the act. Shipped disabled. |
| `.savestatus` | Reply to a status you can already see; it forwards the media/text to your DM. | **PREMIUM candidate, low risk.** Same access you already have (like a screenshot). |
| `.autosavestatus` | Toggle: automatically copies every contact status to your DM. | **PREMIUM, medium risk:** bulk copying of contacts' content. |
| `.autostatus` | Toggle: automatically marks contact statuses as viewed. | **PREMIUM, medium risk:** mass automated reads. |
| `.statusreact` | Toggle: automatically reacts to every contact status. | **PREMIUM, medium risk:** mass automated reactions are a known account-ban trigger. |
| `.anticall` | Rejects incoming calls, warns, blocks a caller after 3 calls. Never blocks owners. | **PREMIUM, low risk.** Acts on your own account. |
| `.autoreply` | Automatic replies (text, voice-note triggers) to incoming chats. | **PREMIUM, medium risk:** unsolicited automated messaging can be flagged as spam. |
| `.ghost` | Changes the linked account's own privacy settings (read receipts, last seen, photo, about). | **PREMIUM, low risk.** Only changes your own settings. |

`.autoreact` and `.autoview` do not exist under those names. Their real equivalents are `.statusreact` and `.autostatus`, which is what I classified. `.autoread` (marks chats read) stays FREE as an ordinary setting.

## Other things I flagged

- **Duplicate command name:** `server` is defined in both `commands/ping.js` and `commands/server.js`. The later file wins, so the public `.server` is shadowed by the owner-only one. Not changed; rename one if you want both.
- **Published network key:** `config.js` contains a real-looking `networkKey` committed to a public repo. Treat it as public. Rotate `NETWORK_KEY` on the server and set the new one in each host's `config.local.json`. Premium and admin do not depend on that key being secret (they use per-installation tokens, an admin password and signed webhooks), but it is what stops random traffic from using your Firestore quota.
- **Owner-only economy:** the existing local and global economy commands are gated to the owner and paired numbers (`inNetwork` / `economy.js`), not to every chat member. I kept that exactly as it was.
- **High-impact owner commands** (`eval`, `exec`, `getsession`, `broadcast`, `kickall`, `reactall`, `joinall`) are owner-only and several are marked dangerous in the code. Left as is, flagged `watch` in the Command Manager. `broadcast` and mass joins/reactions are the most common causes of WhatsApp bans.

## A. Free WhatsApp management (46)

| Command | Aliases | Default | Policy | File |
|---|---|---|---|---|
| `.add` | `inviteuser` | FREE | watch (medium: adding people to groups in bulk can be flagged) | group.js |
| `.addbadword` | - | FREE | ok | guardcmds.js |
| `.afk` | - | FREE | ok | cool.js |
| `.antibadword` | `antiswear` | FREE | ok | guardcmds.js |
| `.antilink` | `nolink` | FREE | ok | group.js |
| `.antispam` | `antiflood` | FREE | ok | guardcmds.js |
| `.antitoxic` | `antibad` | FREE | ok | group.js |
| `.approveall` | `approve` | FREE | watch (low) | group2.js |
| `.autosticker` | `autos` | FREE | ok | group.js |
| `.badwords` | - | FREE | ok | guardcmds.js |
| `.block` | `banuser` | FREE | watch (low) | owner.js |
| `.delbadword` | - | FREE | ok | guardcmds.js |
| `.delete` | `del` `dlt` | FREE | ok | misc.js |
| `.demote` | `unadmin` | FREE | ok | group.js |
| `.disappear` | `ephemeral` | FREE | ok | group2.js |
| `.everyone` | - | FREE | watch (low) | misc.js |
| `.goodbye` | `left` `setgoodbye` | FREE | ok | group.js |
| `.group` | `gc` | FREE | ok | group.js |
| `.groupinfo` | `gcinfo` `infogc` | FREE | ok | group.js |
| `.grouplink` | `link` `invite` | FREE | ok | group.js |
| `.hidetag` | `htag` `hide` | FREE | ok | group.js |
| `.kick` | `remove` | FREE | ok | group.js |
| `.kickall` | `removeall` | FREE | watch (high-impact: mass removal, owner/admin only) | group.js |
| `.levelup` | - | FREE | ok | economy.js |
| `.listadmin` | `admins` | FREE | ok | group.js |
| `.lock` | `close` `mutegc` | FREE | ok | group2.js |
| `.lockinfo` | - | FREE | ok | group2.js |
| `.mute` | `silence` | FREE | ok | group.js |
| `.poll` | `vote` | FREE | ok | cool.js |
| `.promote` | `admin` | FREE | ok | group.js |
| `.react` | `r` | FREE | ok | misc.js |
| `.resetwarn` | `clearwarn` | FREE | ok | cool.js |
| `.revoke` | `resetlink` | FREE | ok | group.js |
| `.setdesc` | `gdesc` | FREE | ok | group.js |
| `.setgrouppp` | `setgpp` `setgcpp` | FREE | ok | group2.js |
| `.setname` | `subject` | FREE | ok | group.js |
| `.tagadmins` | `tagadmin` `calladmins` | FREE | ok | cool.js |
| `.tagall` | `all` `mentionall` | FREE | ok | group.js |
| `.unblock` | `unbanuser` | FREE | ok | owner.js |
| `.unlock` | `open` `unmutegc` | FREE | ok | group2.js |
| `.unlockinfo` | - | FREE | ok | group2.js |
| `.unmute` | `unsilence` | FREE | ok | group.js |
| `.vcf` | `savecontacts` | FREE | watch (medium: exports member phone numbers) | group2.js |
| `.warn` | - | FREE | ok | cool.js |
| `.warnings` | `warns` | FREE | ok | cool.js |
| `.welcome` | `setwelcome` | FREE | ok | group.js |

## B. Free economy (local + global) (103)

| Command | Aliases | Default | Policy | File |
|---|---|---|---|---|
| `.bail` | - | FREE | ok | economy.js |
| `.balance` | `bal` `wallet` `coins` | FREE | ok | economy.js |
| `.bank` | - | FREE | ok | economy.js |
| `.beg` | - | FREE | ok | economy.js |
| `.blackjack` | `bj` | FREE | ok | economy.js |
| `.business` | - | FREE | ok | economy.js |
| `.buy` | - | FREE | ok | economy.js |
| `.claim` | - | FREE | ok | economy.js |
| `.coinflipbet` | `cfb` | FREE | ok | economy.js |
| `.collect` | - | FREE | ok | economy.js |
| `.crypto` | - | FREE | ok | economy.js |
| `.daily` | - | FREE | ok | economy.js |
| `.deposit` | `dep` | FREE | ok | economy.js |
| `.dicebet` | `dicegame` | FREE | ok | economy.js |
| `.donate` | - | FREE | ok | economy.js |
| `.farm` | - | FREE | ok | economy.js |
| `.fish` | - | FREE | ok | economy.js |
| `.gamble` | `bet` | FREE | ok | economy.js |
| `.gbail` | `nbail` | FREE | ok | network.js |
| `.gbalance` | `gbal` `networkbalance` | FREE | ok | network.js |
| `.gbank` | `nbank` | FREE | ok | network.js |
| `.gbeg` | `nbeg` | FREE | ok | network.js |
| `.gblackjack` | `gbj` `nblackjack` | FREE | ok | network.js |
| `.gbusiness` | `nbusiness` `gbiz` | FREE | ok | network.js |
| `.gbuy` | `nbuy` | FREE | ok | network.js |
| `.gclaim` | `nclaim` | FREE | ok | network.js |
| `.gcoinflip` | `ncoinflip` `gcfb` | FREE | ok | network.js |
| `.gcollect` | `ncollect` | FREE | ok | network.js |
| `.gcrypto` | `ncrypto` | FREE | ok | network.js |
| `.gdaily` | `ndaily` | FREE | ok | network.js |
| `.gdeposit` | `ndeposit` | FREE | ok | network.js |
| `.gdicebet` | `ndicebet` `gdicegame` | FREE | ok | network.js |
| `.gfarm` | `nfarm` | FREE | ok | network.js |
| `.gfish` | `nfish` | FREE | ok | network.js |
| `.ggamble` | `ngamble` `gbet` | FREE | ok | network.js |
| `.ggift` | `ngift` | FREE | ok | network.js |
| `.gheist` | `nheist` | FREE | ok | network.js |
| `.ghit` | `nhit` | FREE | ok | network.js |
| `.ghunt` | `nhunt` | FREE | ok | network.js |
| `.ghustle` | `nhustle` | FREE | ok | network.js |
| `.gift` | - | FREE | ok | economy.js |
| `.ginventory` | `ninventory` `ginv` `nbag` | FREE | ok | network.js |
| `.ginvest` | `ninvest` | FREE | ok | network.js |
| `.gjail` | `njail` | FREE | ok | network.js |
| `.gjob` | `njob` | FREE | ok | network.js |
| `.gloan` | `nloan` | FREE | ok | network.js |
| `.glottery` | `nlottery` | FREE | ok | network.js |
| `.gmine` | `nmine` | FREE | ok | network.js |
| `.gnetworth` | `gnw` `nnetworth` | FREE | ok | network.js |
| `.govertime` | `novertime` | FREE | ok | network.js |
| `.gpayloan` | `npayloan` | FREE | ok | network.js |
| `.gpolice` | `npolice` | FREE | ok | network.js |
| `.gpoorest` | `nworst` | FREE | ok | network.js |
| `.grichest` | `networktop` `nleaderboard` | FREE | ok | network.js |
| `.grob` | `nrob` | FREE | ok | network.js |
| `.groulette` | `nroulette` | FREE | ok | network.js |
| `.gscam` | `nscam` | FREE | ok | network.js |
| `.gsell` | `nsell` | FREE | ok | network.js |
| `.gsellbiz` | `gbizsell` `nsellbiz` | FREE | ok | network.js |
| `.gsend` | `gpay` `nsend` | FREE | ok | network.js |
| `.gshop` | `nshop` | FREE | ok | network.js |
| `.gslots` | `nslots` | FREE | ok | network.js |
| `.gstand` | `nstand` | FREE | ok | network.js |
| `.gsteal` | `nsteal` | FREE | ok | network.js |
| `.gtrade` | `ntrade` | FREE | ok | network.js |
| `.gupgrade` | `nupgrade` | FREE | ok | network.js |
| `.guse` | `nuse` | FREE | ok | network.js |
| `.gweekly` | `nweekly` | FREE | ok | network.js |
| `.gwithdraw` | `nwithdraw` | FREE | ok | network.js |
| `.gwork` | `nwork` | FREE | ok | network.js |
| `.heist` | - | FREE | ok | economy.js |
| `.hit` | - | FREE | ok | economy.js |
| `.hunt` | - | FREE | ok | economy.js |
| `.hustle` | - | FREE | ok | economy.js |
| `.inventory` | `inv` `bag` | FREE | ok | economy.js |
| `.invest` | - | FREE | ok | economy.js |
| `.jail` | - | FREE | ok | economy.js |
| `.job` | - | FREE | ok | economy.js |
| `.joinnetwork` | `network` | FREE | ok | network.js |
| `.leaderboard` | `lb` `toprich` | FREE | ok | economy.js |
| `.loan` | - | FREE | ok | economy.js |
| `.lottery` | - | FREE | ok | economy.js |
| `.mine` | - | FREE | ok | economy.js |
| `.overtime` | - | FREE | ok | economy.js |
| `.payloan` | - | FREE | ok | economy.js |
| `.police` | - | FREE | ok | economy.js |
| `.poorest` | - | FREE | ok | economy.js |
| `.richest` | - | FREE | ok | economy.js |
| `.rob` | - | FREE | ok | economy.js |
| `.roulette` | - | FREE | ok | economy.js |
| `.scam` | - | FREE | ok | economy.js |
| `.sell` | - | FREE | ok | economy.js |
| `.shop` | - | FREE | ok | economy.js |
| `.slots` | - | FREE | ok | economy.js |
| `.stand` | - | FREE | ok | economy.js |
| `.steal` | - | FREE | ok | economy.js |
| `.trade` | - | FREE | ok | economy.js |
| `.transfer` | `give` `pay` `send` | FREE | ok | economy.js |
| `.upgrade` | - | FREE | ok | economy.js |
| `.use` | - | FREE | ok | economy.js |
| `.weekly` | - | FREE | ok | economy.js |
| `.withdraw` | `with` | FREE | ok | economy.js |
| `.work` | - | FREE | ok | economy.js |

## C. Free fun (32)

| Command | Aliases | Default | Policy | File |
|---|---|---|---|---|
| `.8ball` | - | FREE | ok | cool.js |
| `.advice` | - | FREE | ok | cool.js |
| `.amongus` | `au` | FREE | ok | fun.js |
| `.aue` | - | FREE | ok | fun.js |
| `.aui` | - | FREE | ok | fun.js |
| `.aun` | - | FREE | ok | fun.js |
| `.aup` | - | FREE | ok | fun.js |
| `.aur` | - | FREE | ok | fun.js |
| `.aus` | - | FREE | ok | fun.js |
| `.auv` | - | FREE | ok | fun.js |
| `.cat` | - | FREE | ok | cool.js |
| `.couplepp` | `cpp` | FREE | ok | extra.js |
| `.dare` | `d` | FREE | ok | fun.js |
| `.dice` | `roll` | FREE | ok | fun.js |
| `.dog` | - | FREE | ok | cool.js |
| `.exitau` | - | FREE | ok | fun.js |
| `.fact` | `facts` | FREE | ok | fun.js |
| `.flip` | `coin` | FREE | ok | fun.js |
| `.inviteau` | `auinvite` | FREE | ok | fun.js |
| `.joke` | `jokes` | FREE | ok | fun.js |
| `.leaveau` | - | FREE | ok | fun.js |
| `.meme` | - | FREE | ok | cool.js |
| `.pick` | `choose` | FREE | ok | fun.js |
| `.quoteanime` | `animequote` | FREE | ok | fun.js |
| `.rank` | `level` `xp` `profile` | FREE | ok | economy.js |
| `.rate` | `howgay` `hot` | FREE | ok | fun.js |
| `.ship` | `couple` | FREE | ok | fun.js |
| `.slot` | `slotmachine` | FREE | ok | fun.js |
| `.startau` | - | FREE | ok | fun.js |
| `.top` | - | FREE | ok | economy.js |
| `.trivia` | `quiz` | FREE | ok | cool.js |
| `.truth` | `t` | FREE | ok | fun.js |

## D. Advanced (Premium candidates / restricted) (22)

| Command | Aliases | Default | Policy | File |
|---|---|---|---|---|
| `.anticall` | - | PREMIUM | watch (low: blocks callers; own account) | settings.js |
| `.antidelete` | `antidel` | RESTRICTED | restricted (Forwards messages other people deleted for everyone to your DM, defeating their deletion) | owner.js |
| `.autobio` | `bioclock` | PREMIUM | ok | autobio.js |
| `.autoreply` | `ar` | PREMIUM | watch (medium: unsolicited automated messaging can be flagged as spam) | autoreply.js |
| `.autosavestatus` | - | PREMIUM | watch (medium: bulk copying of contacts' content) | settings.js |
| `.autostatus` | - | PREMIUM | watch (medium: mass automated status reads) | settings.js |
| `.delpost` | `delstatus` `deletepost` | PREMIUM | ok | status.js |
| `.gcstatus` | `swgc` `groupstatus` `gstatus` `gcstory` | PREMIUM | watch (low) | gcstatus.js |
| `.ghost` | `ghostmode` | PREMIUM | watch (low: only changes your own privacy settings) | ghost.js |
| `.gideonai` | `ask` | PREMIUM | ok | ai.js |
| `.hd` | `remini` `enhance` | PREMIUM | ok | maker.js |
| `.imagine` | `aiimage` `draw` | PREMIUM | ok | ai.js |
| `.postpairstatus` | `pairstatus` | PREMIUM | ok | status.js |
| `.poststatus` | `mystatus` `poststory` | PREMIUM | watch (low) | status.js |
| `.reloadreply` | - | PREMIUM | ok | autoreply.js |
| `.removebg` | `nobg` `rmbg` | PREMIUM | ok | maker.js |
| `.replies` | `replylist` | PREMIUM | ok | autoreply.js |
| `.replytest` | - | PREMIUM | ok | autoreply.js |
| `.savestatus` | `getstatus` `statusdl` `sstatus` | PREMIUM | watch (low: you can already see this status) | status.js |
| `.statusreact` | - | PREMIUM | watch (medium: mass automated reactions are a known ban trigger) | settings.js |
| `.vv` | `viewonce` `reveal` | RESTRICTED | restricted (Re-posts someone else's view-once media, defeating the sender's one-view choice) | vv.js |
| `.vv2` | `vvdm` `reveal2` `stealvv` | RESTRICTED | restricted (Silently copies someone else's view-once media to your DM and deletes your command message to hide it) | vv2.js |

## Other free utilities (not one of the four named groups; kept FREE so nothing is removed) (105)

| Command | Aliases | Default | Policy | File |
|---|---|---|---|---|
| `.addowner` | `ao` | FREE | ok | owner.js |
| `.alive` | `online` | FREE | ok | ping.js |
| `.allowdev` | - | FREE | ok | settings.js |
| `.alwaysonline` | - | FREE | ok | settings.js |
| `.attp` | `attp2` | FREE | ok | maker.js |
| `.autoread` | - | FREE | ok | settings.js |
| `.autotyping` | - | FREE | ok | settings.js |
| `.ban` | `banbot` | FREE | ok | owner.js |
| `.banlist` | `banned` | FREE | ok | owner.js |
| `.base64` | `b64` | FREE | ok | tools.js |
| `.bass` | `deep` | FREE | ok | media.js |
| `.bible` | - | FREE | ok | cool.js |
| `.botcount` | - | FREE | ok | dev.js |
| `.botstatus` | `settings` | FREE | ok | settings.js |
| `.broadcast` | `bc` | FREE | watch (high: bulk messaging is the most common cause of bans) | owner.js |
| `.buttons` | - | FREE | ok | settings.js |
| `.calc` | `calculate` `math` | FREE | ok | tools.js |
| `.channel` | `follow` `waichannel` | FREE | ok | misc.js |
| `.clear` | `cleardisk` `cleanup` `freespace` | FREE | ok | server.js |
| `.coinprice` | `price` `cryptoprice` | FREE | ok | cool.js |
| `.currency` | `convert` `fx` | FREE | ok | cool.js |
| `.define` | `dictionary` `dict` | FREE | ok | ai.js |
| `.delowner` | `do` | FREE | ok | owner.js |
| `.delremind` | `cancelremind` `unschedule` | FREE | ok | remind.js |
| `.devowner` | `developer` `contactdev` `gpraise` | FREE | ok | devowner.js |
| `.emojimix` | `mix` | FREE | ok | sticker.js |
| `.eval` | `>` `execute` | FREE | watch (high: arbitrary code execution, owner only + dangerous) | owner.js |
| `.example` | `ex` | FREE | ok | example.js |
| `.exec` | `$` `term` | FREE | watch (high: arbitrary shell execution, owner only + dangerous) | owner.js |
| `.fb` | `facebook` `fbdl` | FREE | ok | download.js |
| `.getbio` | `bio` `about` | FREE | ok | media.js |
| `.getpp` | `pp` `profilepic` `dp` | FREE | ok | media.js |
| `.getsession` | `session` | FREE | watch (high: exposes the session credentials, owner only + dangerous) | owner.js |
| `.gitclone` | `git` | FREE | ok | download.js |
| `.github` | `ghuser` | FREE | ok | ai.js |
| `.id` | `jid` `chatid` | FREE | ok | misc.js |
| `.ig` | `igdl` `instagram` | FREE | ok | download.js |
| `.join` | `joingc` | FREE | ok | owner.js |
| `.joinall` | - | FREE | watch (high: mass group/channel joins across accounts) | dev.js |
| `.leave` | `leavegc` | FREE | ok | owner.js |
| `.listowner` | `owners` `coowners` | FREE | ok | owner.js |
| `.listpaired` | `paired` `pairlist` | FREE | ok | pair.js |
| `.lyrics` | `lyric` | FREE | ok | ai.js |
| `.mediafire` | `mf` | FREE | ok | download.js |
| `.menu` | `help` `list` `gideon` | FREE | ok | menu.js |
| `.notify` | `devnotify` `announce` | FREE | watch (low: developer broadcast to owners) | dev.js |
| `.nowa` | `checkwa` | FREE | watch (medium: checks whether numbers are on WhatsApp (mass use is flagged)) | misc.js |
| `.npm` | `npmjs` | FREE | ok | ai.js |
| `.org` | `organization` `website` | FREE | ok | misc.js |
| `.owner` | `creator` `dev` | FREE | ok | ping.js |
| `.pair` | `adduser` `linkuser` | FREE | ok | pair.js |
| `.password` | `genpass` | FREE | ok | cool.js |
| `.ping` | `speed` | FREE | ok | ping.js |
| `.pinterest` | `pin` | FREE | ok | extra.js |
| `.play` | `song` `ytmp3` | FREE | ok | download.js |
| `.premium` | `gid` `myplan` | FREE | ok | premium.js |
| `.privacy` | - | FREE | ok | ghost.js |
| `.public` | `modepublic` | FREE | ok | owner.js |
| `.qr` | `qrcode` | FREE | ok | extra.js |
| `.quote` | `q` `quotely` | FREE | ok | tools.js |
| `.reactall` | - | FREE | watch (high: mass reactions across accounts) | dev.js |
| `.readmore` | `more` | FREE | ok | tools.js |
| `.readqr` | `scanqr` | FREE | ok | extra.js |
| `.remind` | `reminder` `remindme` | FREE | ok | remind.js |
| `.reminders` | `myreminders` `scheduled` | FREE | ok | remind.js |
| `.restart` | `reboot` | FREE | ok | owner.js |
| `.reverse` | `rev` | FREE | ok | tools.js |
| `.runtime` | `uptime` | FREE | ok | ping.js |
| `.save` | `sv` | FREE | ok | media.js |
| `.schedule` | `sched` `sendlater` | FREE | ok | remind.js |
| `.script` | `sc` `repo` | FREE | ok | ping.js |
| `.self` | `private` `modeprivate` | FREE | ok | owner.js |
| `.server` | `serverinfo` `sysinfo` `health` | FREE | ok | server.js |
| `.setbio` | `setstatus` | FREE | ok | owner.js |
| `.setpp` | `fullpp` `setpic` | FREE | ok | owner.js |
| `.setprefix` | - | FREE | ok | settings.js |
| `.shorturl` | `short` `tinyurl` | FREE | ok | tools.js |
| `.smeme` | `stickermeme` `memegen` | FREE | ok | maker.js |
| `.ssweb` | `ss` `screenshot` | FREE | ok | tools.js |
| `.sticker` | `s` `stiker` | FREE | ok | sticker.js |
| `.store` | `apps` | FREE | ok | misc.js |
| `.style` | `fancy` `fancytext` | FREE | ok | tools.js |
| `.subscribe` | `buypremium` `upgrade-premium` | FREE | ok | premium.js |
| `.take` | `wm` | FREE | ok | sticker.js |
| `.theme` | `themes` | FREE | ok | theme.js |
| `.tiktok` | `tt` `ttdl` | FREE | ok | download.js |
| `.time` | `clock` | FREE | ok | cool.js |
| `.tiny` | `resize` | FREE | ok | media.js |
| `.toimg` | `toimage` `img` | FREE | ok | sticker.js |
| `.tomp3` | `toaudio` | FREE | ok | media.js |
| `.toqr` | `makeqr` | FREE | ok | extra.js |
| `.tourl` | `upload` | FREE | ok | tools.js |
| `.tovid` | `tovideo` `tomp4` | FREE | ok | sticker.js |
| `.tovn` | `vn` | FREE | ok | media.js |
| `.translate` | `tr` | FREE | ok | tools.js |
| `.ttp` | `textsticker` | FREE | ok | maker.js |
| `.unban` | `unbanbot` | FREE | ok | owner.js |
| `.unpair` | `removeuser` `unlinkuser` | FREE | ok | pair.js |
| `.update` | `gitpull` | FREE | ok | update.js |
| `.wallpaper` | `wp` | FREE | ok | extra.js |
| `.weather` | `cuaca` | FREE | ok | tools.js |
| `.wiki` | `wikipedia` | FREE | ok | ai.js |
| `.youtube` | `yt` | FREE | ok | misc.js |
| `.ytmp4` | `video` `ytv` | FREE | ok | download.js |
| `.yts` | `ytsearch` | FREE | ok | download.js |

