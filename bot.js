const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { Player } = require('discord-player');
const { RiffyClient } = require('riffy');
const fs = require('fs');

// Create the bot client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Music system using discord-player
const player = new Player(client);

// Riffy client for advanced music handling
const riffy = new RiffyClient({
  node: 'https://node.jirayu.dev', // Replace with Jirayu public node
  apiKey: 'YOUR_API_KEY',         // Replace with your API key
});

// Configuration
const config = {
  prefix: '!', // Replace with your desired prefix
  token: 'YOUR_BOT_TOKEN', // Replace with your bot token
  ownerId: 'YOUR_USER_ID', // Replace with your Discord user ID
};

// Antinuke system
client.on('guildMemberRemove', async (member) => {
  const auditLogs = await member.guild.fetchAuditLogs({ type: 'MEMBER_KICK' });
  const entry = auditLogs.entries.first();
  if (entry && entry.executor.id !== config.ownerId) {
    const executor = entry.executor;
    await member.guild.members.ban(executor.id, { reason: 'Antinuke: Unauthorized member kick detected' });
    console.log(`[ANTINUKE] Banned ${executor.tag} for unauthorized actions.`);
  }
});

// Automod system
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const badWords = ['badword1', 'badword2']; // Replace with actual words
  const spamThreshold = 5; // Number of messages considered spam
  const userMessages = client.userMessages || new Map();

  // Bad words filter
  if (badWords.some((word) => message.content.toLowerCase().includes(word))) {
    await message.delete();
    await message.channel.send(`${message.author}, please avoid using inappropriate language.`);
    console.log(`[AUTOMOD] Deleted inappropriate message from ${message.author.tag}.`);
  }

  // Spam detection
  const userMessageLog = userMessages.get(message.author.id) || [];
  userMessageLog.push(Date.now());
  userMessages.set(message.author.id, userMessageLog.filter((timestamp) => Date.now() - timestamp < 10000)); // 10 seconds

  if (userMessages.get(message.author.id).length > spamThreshold) {
    await message.member.timeout(60000); // Timeout for 1 minute
    await message.channel.send(`${message.author}, you have been temporarily muted for spamming.`);
    console.log(`[AUTOMOD] Muted ${message.author.tag} for spamming.`);
  }
});

// Autorecovery system
client.on('guildUpdate', async (oldGuild, newGuild) => {
  if (newGuild.name !== oldGuild.name) {
    await newGuild.setName(oldGuild.name);
    console.log(`[AUTORECOVERY] Restored guild name to ${oldGuild.name}.`);
  }
});

// Music system commands
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(config.prefix) || message.author.bot) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'play') {
    const query = args.join(' ');
    const queue = player.createQueue(message.guild, {
      metadata: { channel: message.channel },
    });

    if (!queue.connection) await queue.connect(message.member.voice.channel);
    const track = await riffy.search(query, { limit: 1, type: 'track' });
    if (!track) return message.channel.send('No results found.');

    queue.addTrack(track[0]);
    await message.channel.send(`Added **${track[0].title}** to the queue.`);
    if (!queue.playing) await queue.play();
  }

  if (command === 'skip') {
    const queue = player.getQueue(message.guild);
    if (!queue) return message.channel.send('No music is playing.');
    queue.skip();
    await message.channel.send('Skipped the current track.');
  }

  if (command === 'stop') {
    const queue = player.getQueue(message.guild);
    if (!queue) return message.channel.send('No music is playing.');
    queue.destroy();
    await message.channel.send('Stopped the music and cleared the queue.');
  }
});

// Bot ready event
client.once('ready', () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
});

// Login the bot
client.login(config.token);
