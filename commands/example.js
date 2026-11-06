module.exports = {
  name: 'example',
  aliases: ['ex'],
  desc: 'Copy this file to add a new command',
  category: 'general',
  async run(sock, m, { text, args, prefix, config, store, fn }) {
    await m.reply(
      `Command loaded.\n` +
        `Text: ${text || '-'}\n` +
        `Args: ${args.join(', ') || '-'}\n` +
        `Prefix: ${prefix}\n\n` +
        `Copy commands/example.js, rename the file, change name/desc/run. Nothing else needs editing.`
    )
  }
}
