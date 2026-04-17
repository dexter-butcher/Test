const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { Player } = require('discord-player');
const { RiffyClient } = require('riffy');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const player = new Player(client);
const riffy = new RiffyClient({
  node: 'https://node.jirayu.dev',
  apiKey: 'YOUR_API_KEY',
});

const config = {
  prefix: '!',
  token: 'YOUR_BOT_TOKEN',
  ownerId: 'YOUR_USER_ID',
  backupFile: './guildBackup.json',
};

// --- Automod Settings ---
const automod = {
  badWords: ['badword1', 'badword2', 'badword3'],
  linkRegex: /(https?:\/\/[^\s]+)/g,
  mentionThreshold: 5,
  spamThreshold: 5,
  spamWindow: 10000, // ms
};

const userMessages = new Map();

// --- Backup/Restore ---
function backupGuild(guild) {
  const backup = {
    name: guild.name,
    roles: guild.roles.cache.map(r => ({
      name: r.name,
      color: r.color,
      permissions: r.permissions.bitfield,
      position: r.position,
      mentionable: r.mentionable,
      hoist: r.hoist,
      id: r.id,
    })),
    channels: guild.channels.cache.map(c => ({
      name: c.name,
      type: c.type,
      topic: c.topic,
      position: c.position,
      parent: c.parentId,
      id: c.id,
    })),
  };
  fs.writeFileSync(config.backupFile, JSON.stringify(backup, null, 2));
}

async function restoreGuild(guild) {
  if (!fs.existsSync(config.backupFile)) return;
  const backup = JSON.parse(fs.readFileSync(config.backupFile));
  // Restore name
  if (guild.name !== backup.name) await guild.setName(backup.name);
  // Restore roles
  for (const role of backup.roles) {
    const existing = guild.roles.cache.find(r => r.name === role.name);
    if (!existing) {
      await guild.roles.create({
        name: role.name,
        color: role.color,
        permissions: role.permissions,
        mentionable: role.mentionable,
        hoist: role.hoist,
        position: role.position,
      });
    }
  }
  // Restore channels
  for (const channel of backup.channels) {
    const existing = guild.channels.cache.find(c => c.name === channel.name && c.type === channel.type);
    if (!existing) {
      await guild.channels.create({
        name: channel.name,
        type: channel.type,
        topic: channel.topic,
        parent: channel.parent,
        position: channel.position,
      });
    }
  }
}

// --- Antinuke ---
client.on('guildMemberRemove', async (member) => {
  const auditLogs = await member.guild.fetchAuditLogs({ type: 'MEMBER_KICK' });
  const entry = auditLogs.entries.first();
  if (entry && entry.executor.id !== config.ownerId) {
    await member.guild.members.ban(entry.executor.id, { reason: 'Antinuke: Unauthorized kick' });
  }
});

client.on('guildBanAdd', async (ban) => {
  const auditLogs = await ban.guild.fetchAuditLogs({ type: 'MEMBER_BAN_ADD' });
  const entry = auditLogs.entries.first();
  if (entry && entry.executor.id !== config.ownerId) {
    await ban.guild.members.ban(entry.executor.id, { reason: 'Antinuke: Unauthorized ban' });
  }
});

client.on('roleDelete', async (role) => {
  const auditLogs = await role.guild.fetchAuditLogs({ type: 'ROLE_DELETE' });
  const entry = auditLogs.entries.first();
  if (entry && entry.executor.id !== config.ownerId) {
    await role.guild.members.ban(entry.executor.id, { reason: 'Antinuke: Unauthorized role deletion' });
    await restoreGuild(role.guild);
  }
});

client.on('channelDelete', async (channel) => {
  const auditLogs = await channel.guild.fetchAuditLogs({ type: 'CHANNEL_DELETE' });
  const entry = auditLogs.entries.first();
  if (entry && entry.executor.id !== config.ownerId) {
    await channel.guild.members.ban(entry.executor.id, { reason: 'Antinuke: Unauthorized channel deletion' });
    await restoreGuild(channel.guild);
  }
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
  if (newGuild.name !== oldGuild.name) {
    await newGuild.setName(oldGuild.name);
    backupGuild(newGuild);
  }
});

// --- Automod ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Bad words
  if (automod.badWords.some(word => message.content.toLowerCase().includes(word))) {
    await message.delete();
    await message.channel.send(`${message.author}, inappropriate language is not allowed.`);
    return;
  }

  // Link detection
  if (automod.linkRegex.test(message.content)) {
    await message.delete();
    await message.channel.send(`${message.author}, posting links is not allowed.`);
    return;
  }

  // Mention spam
  if (message.mentions.users.size >= automod.mentionThreshold) {
    await message.delete();
    await message.channel.send(`${message.author}, excessive mentions are not allowed.`);
    return;
  }

  // Spam detection
  const log = userMessages.get(message.author.id) || [];
  log.push(Date.now());
  userMessages.set(message.author.id, log.filter(ts => Date.now() - ts < automod.spamWindow));
  if (userMessages.get(message.author.id).length > automod.spamThreshold) {
    await message.member.timeout(60000);
    await message.channel.send(`${message.author}, you have been muted for spamming.`);
    userMessages.set(message.author.id, []);
    return;
  }
});

// --- Music Commands ---
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(config.prefix) || message.author.bot) return;
  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Play
  if (command === 'play') {
    const query = args.join(' ');
    const queue = player.createQueue(message.guild, { metadata: { channel: message.channel } });
    if (!queue.connection) await queue.connect(message.member.voice.channel);
    const tracks = await riffy.search(query, { limit: 1, type: 'track' });
    if (!tracks.length) return message.channel.send('No results found.');
    queue.addTrack(tracks[0]);
    await message.channel.send(`Added **${tracks[0].title}** to the queue.`);
    if (!queue.playing) await queue.play();
  }

  // Pause
  if (command === 'pause') {
    const queue = player.getQueue(message.guild);
    if (!queue || !queue.playing) return message.channel.send('No music is playing.');
    queue.setPaused(true);
    await message.channel.send('Paused the music.');
  }

  // Resume
  if (command === 'resume') {
    const queue = player.getQueue(message.guild);
    if (!queue || !queue.playing) return message.channel.send('No music is playing.');
    queue.setPaused(false);
    await message.channel.send('Resumed the music.');
  }

  // Volume
  if (command === 'volume') {
    const queue = player.getQueue(message.guild);
    if (!queue || !queue.playing) return message.channel.send('No music is playing.');
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 100) return message.channel.send('Volume must be 0-100.');
    queue.setVolume(vol);
    await message.channel.send(`Volume set to ${vol}%.`);
  }

  // Queue
  if (command === 'queue') {
    const queue = player.getQueue(message.guild);
    if (!queue || !queue.tracks.length) return message.channel.send('Queue is empty.');
    const q = queue.tracks.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
    await message.channel.send(`Current Queue:\n${q}`);
  }

  // Remove
  if (command === 'remove') {
    const queue = player.getQueue(message.guild);
    const idx = parseInt(args[0]) - 1;
    if (!queue || !queue.tracks[idx]) return message.channel.send('Invalid track number.');
    queue.remove(idx);
    await message.channel.send(`Removed track #${idx + 1} from queue.`);
  }

  // Nowplaying
  if (command === 'nowplaying') {
    const queue = player.getQueue(message.guild);
    if (!queue || !queue.playing) return message.channel.send('No music is playing.');
    await message.channel.send(`Now playing: **${queue.current.title}**`);
  }

  // Skip
  if (command === 'skip') {
    const queue = player.getQueue(message.guild);
    if (!queue || !queue.playing) return message.channel.send('No music is playing.');
    queue.skip();
    await message.channel.send('Skipped the current track.');
  }

  // Stop
  if (command === 'stop') {
    const queue = player.getQueue(message.guild);
    if (!queue || !queue.playing) return message.channel.send('No music is playing.');
    queue.destroy();
    await message.channel.send('Stopped the music and cleared the queue.');
  }

  // Leave
  if (command === 'leave') {
    const queue = player.getQueue(message.guild);
    if (!queue || !queue.connection) return message.channel.send('Not connected.');
    queue.connection.disconnect();
    await message.channel.send('Disconnected from voice channel.');
  }

  // Restore (manual)
  if (command === 'restore') {
    if (message.author.id !== config.ownerId) return message.channel.send('Only the owner can restore.');
    await restoreGuild(message.guild);
    await message.channel.send('Guild restoration completed.');
  }

  // Backup (manual)
  if (command === 'backup') {
    if (message.author.id !== config.ownerId) return message.channel.send('Only the owner can backup.');
    backupGuild(message.guild);
    await message.channel.send('Backup completed.');
  }
});

// --- Backup on startup ---
client.on('ready', () => {
  client.guilds.cache.forEach(guild => backupGuild(guild));
  console.log(`[BOT] Logged in as ${client.user.tag}`);
});

// --- Login ---
client.login(config.token);
