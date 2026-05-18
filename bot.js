require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes,
  EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { Rcon } = require('rcon-client');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ── Config ──
const CONAN_DIR = process.env.CONAN_DIR || 'D:\\ConanServer';
const SERVER_EXE = path.join(CONAN_DIR, 'ConanSandboxServer.exe');
const SETTINGS_PATH = path.join(CONAN_DIR, 'ConanSandbox', 'Saved', 'Config', 'WindowsServer', 'ServerSettings.ini');
const DATA_DIR = path.join(__dirname, 'data');
const HOMES_FILE = path.join(DATA_DIR, 'homes.json');
const WARPS_FILE = path.join(DATA_DIR, 'warps.json');
const SPAWNS_FILE = path.join(DATA_DIR, 'spawns.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── JSON storage ──
function load(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// ── RCON helper (custom impl for Conan's non-standard auth packets) ──
function rconPacket(id, type, body) {
  const size = 10 + Buffer.byteLength(body, 'utf8');
  const buf = Buffer.alloc(size + 4);
  buf.writeInt32LE(size, 0); buf.writeInt32LE(id, 4); buf.writeInt32LE(type, 8);
  buf.write(body, 12, 'utf8'); buf[size + 2] = 0; buf[size + 3] = 0;
  return buf;
}

function rcon(command) {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const host = process.env.RCON_HOST || '127.0.0.1';
    const port = parseInt(process.env.RCON_PORT) || 25575;
    const pw = process.env.RCON_PASSWORD || '';
    let authDone = false, result = '';
    const c = net.connect(port, '10.0.0.132', () => c.write(rconPacket(1, 3, pw)));
    c.setTimeout(8000);
    c.on('data', d => {
      const type = d.readInt32LE(8);
      const body = d.toString('utf8', 12, d.length - 2);
      if (!authDone) {
        if (body.includes('Authentication failed') || body.includes('Authfailed'))
          { c.end(); return reject(new Error('RCON auth failed')); }
        authDone = true;
        c.write(rconPacket(2, 2, command));
      } else {
        result += body;
        // Give a short window for multi-packet responses
        setTimeout(() => { c.end(); resolve(result.trim()); }, 500);
      }
    });
    c.on('timeout', () => { c.end(); authDone ? resolve(result.trim()) : reject(new Error('RCON timeout')); });
    c.on('error', e => reject(e));
  });
}

// ── Server helpers ──
function isServerRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq ConanSandboxServer-Win64-Shipping.exe" /FO CSV /NH', { encoding: 'utf8' });
    return out.includes('ConanSandboxServer');
  } catch { return false; }
}

function getProcessInfo() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-Process ConanSandboxServer-Win64-Shipping -EA SilentlyContinue | Select Id,CPU,@{N=\'MemMB\';E={[math]::Round($_.WorkingSet64/1MB)}},StartTime | ConvertTo-Json"',
      { encoding: 'utf8' }
    );
    return JSON.parse(out);
  } catch { return null; }
}

// ── Embed colors ──
const COLORS = { red: 0xc0392b, green: 0x27ae60, yellow: 0xf39c12, blue: 0x3498db, purple: 0x9b59b6 };

// ── Slash Commands Definition ──
const commands = [
  // Server management
  new SlashCommandBuilder().setName('status').setDescription('Show server status'),
  new SlashCommandBuilder().setName('players').setDescription('List online players'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show server info and connection details'),
  new SlashCommandBuilder().setName('rules').setDescription('Show server rules'),

  // Admin commands
  new SlashCommandBuilder().setName('start').setDescription('Start the server').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('stop').setDescription('Stop the server').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('restart').setDescription('Restart the server').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('broadcast')
    .setDescription('Broadcast a message to all players')
    .addStringOption(o => o.setName('message').setDescription('Message to broadcast').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('rcon')
    .setDescription('Send a raw RCON command')
    .addStringOption(o => o.setName('command').setDescription('RCON command').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('kick')
    .setDescription('Kick a player')
    .addStringOption(o => o.setName('player').setDescription('Player name or Steam ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('ban')
    .setDescription('Ban a player')
    .addStringOption(o => o.setName('player').setDescription('Player name or Steam ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('unban')
    .setDescription('Unban a player')
    .addStringOption(o => o.setName('player').setDescription('Steam ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Teleport & Home system
  new SlashCommandBuilder().setName('sethome')
    .setDescription('Save your current location as a home (provide coords from in-game)')
    .addStringOption(o => o.setName('name').setDescription('Home name').setRequired(true))
    .addNumberOption(o => o.setName('x').setDescription('X coordinate (from in-game TeleportPlayer)').setRequired(true))
    .addNumberOption(o => o.setName('y').setDescription('Y coordinate').setRequired(true))
    .addNumberOption(o => o.setName('z').setDescription('Z coordinate').setRequired(true)),
  new SlashCommandBuilder().setName('home')
    .setDescription('Teleport to a saved home')
    .addStringOption(o => o.setName('name').setDescription('Home name').setRequired(true)),
  new SlashCommandBuilder().setName('delhome')
    .setDescription('Delete a saved home')
    .addStringOption(o => o.setName('name').setDescription('Home name').setRequired(true)),
  new SlashCommandBuilder().setName('homes').setDescription('List your saved homes'),

  // Warp system (admin-defined locations)
  new SlashCommandBuilder().setName('warp')
    .setDescription('Teleport to a warp point')
    .addStringOption(o => o.setName('name').setDescription('Warp name').setRequired(true)),
  new SlashCommandBuilder().setName('warps').setDescription('List available warp points'),
  new SlashCommandBuilder().setName('setwarp')
    .setDescription('Create a warp point')
    .addStringOption(o => o.setName('name').setDescription('Warp name').setRequired(true))
    .addNumberOption(o => o.setName('x').setDescription('X coordinate').setRequired(true))
    .addNumberOption(o => o.setName('y').setDescription('Y coordinate').setRequired(true))
    .addNumberOption(o => o.setName('z').setDescription('Z coordinate').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Warp description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('delwarp')
    .setDescription('Delete a warp point')
    .addStringOption(o => o.setName('name').setDescription('Warp name').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Spawn system
  new SlashCommandBuilder().setName('setspawn')
    .setDescription('Set the custom spawn location for new players')
    .addNumberOption(o => o.setName('x').setDescription('X').setRequired(true))
    .addNumberOption(o => o.setName('y').setDescription('Y').setRequired(true))
    .addNumberOption(o => o.setName('z').setDescription('Z').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('spawn').setDescription('Teleport to the server spawn point'),

  // Player teleport (admin)
  new SlashCommandBuilder().setName('tp')
    .setDescription('Teleport a player to coordinates')
    .addStringOption(o => o.setName('player').setDescription('Player name or Steam ID').setRequired(true))
    .addNumberOption(o => o.setName('x').setDescription('X').setRequired(true))
    .addNumberOption(o => o.setName('y').setDescription('Y').setRequired(true))
    .addNumberOption(o => o.setName('z').setDescription('Z').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('tpto')
    .setDescription('Teleport to a player')
    .addStringOption(o => o.setName('player').setDescription('Player name or Steam ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Link Steam ID
  new SlashCommandBuilder().setName('link')
    .setDescription('Link your Discord account to your Steam ID for teleport commands')
    .addStringOption(o => o.setName('steamid').setDescription('Your Steam ID (from in-game player list)').setRequired(true)),
  new SlashCommandBuilder().setName('unlink').setDescription('Unlink your Steam ID'),

  // MOTD
  new SlashCommandBuilder().setName('motd').setDescription('Show today\'s message of the day'),
  new SlashCommandBuilder().setName('refreshmotd').setDescription('Force refresh the MOTD now')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Utility
  new SlashCommandBuilder().setName('settings').setDescription('Show current server balance settings'),
  new SlashCommandBuilder().setName('kit')
    .setDescription('Give a starter kit to a player (admin)')
    .addStringOption(o => o.setName('player').setDescription('Player Steam ID').setRequired(true))
    .addStringOption(o => o.setName('kit').setDescription('Kit name').setRequired(true)
      .addChoices(
        { name: 'Starter (stone tools + fiber)', value: 'starter' },
        { name: 'Builder (T2 mats)', value: 'builder' },
        { name: 'Warrior (iron weapons + medium armor)', value: 'warrior' },
        { name: 'Alchemist (potions + ingredients)', value: 'alchemist' },
      ))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

// ── Kit definitions (item IDs) ──
const KITS = {
  starter: [
    { id: 51001, qty: 1, name: 'Stone Hatchet' },
    { id: 51002, qty: 1, name: 'Stone Pick' },
    { id: 11502, qty: 50, name: 'Plant Fiber' },
    { id: 11001, qty: 50, name: 'Stone' },
    { id: 11101, qty: 30, name: 'Wood' },
    { id: 13005, qty: 5, name: 'Waterskin' },
  ],
  builder: [
    { id: 11108, qty: 500, name: 'Shaped Wood' },
    { id: 11009, qty: 500, name: 'Brick' },
    { id: 11058, qty: 200, name: 'Iron Reinforcement' },
    { id: 11502, qty: 200, name: 'Twine' },
  ],
  warrior: [
    { id: 51011, qty: 1, name: 'Iron Broadsword' },
    { id: 51301, qty: 1, name: 'Iron Shield' },
    { id: 52003, qty: 1, name: 'Medium Chest' },
    { id: 52004, qty: 1, name: 'Medium Gauntlets' },
    { id: 52005, qty: 1, name: 'Medium Leggings' },
    { id: 52006, qty: 1, name: 'Medium Boots' },
    { id: 18100, qty: 20, name: 'Aloe Soup' },
  ],
  alchemist: [
    { id: 18060, qty: 20, name: 'Aloe Extract' },
    { id: 18301, qty: 10, name: 'Set Antidote' },
    { id: 18052, qty: 10, name: 'Healing Waterskin' },
    { id: 14180, qty: 50, name: 'Yellow Lotus Blossom' },
    { id: 14181, qty: 20, name: 'Alchemical Base' },
  ],
};

// ── Default warps ──
function initWarps() {
  const warps = load(WARPS_FILE);
  if (Object.keys(warps).length === 0) {
    const defaults = {
      'noob-river': { x: -76287, y: 80958, z: -6551, desc: 'Starting area on the southern river' },
      'sepermeru': { x: -243076, y: 92564, z: -9338, desc: 'City of Relic Hunters' },
      'mounds': { x: -107975, y: 234798, z: -3781, desc: 'Mounds of the Dead' },
      'volcano': { x: -107654, y: 280000, z: 10000, desc: 'The Volcano region' },
      'jungle': { x: -27000, y: 128000, z: -8000, desc: 'Eastern jungle' },
      'unnamed-city': { x: -188000, y: 128000, z: -9000, desc: 'The Unnamed City ruins' },
    };
    save(WARPS_FILE, defaults);
    return defaults;
  }
  return warps;
}

// ── Bot client ──
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  initWarps();

  // Daily MOTD system — update now and schedule daily at midnight
  const { updateMOTD, generateMOTD } = require('./motd');
  try { await updateMOTD(); } catch (e) { console.log('MOTD init failed:', e.message); }
  // Schedule daily at midnight
  const msToMidnight = () => { const n = new Date(), m = new Date(n); m.setHours(24,0,0,0); return m - n; };
  setTimeout(function daily() { updateMOTD().catch(() => {}); setTimeout(daily, 86400000); }, msToMidnight());

  // Register slash commands (preserve any existing Entry Point command)
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const cmdData = commands.map(c => c.toJSON());
  try {
    // Fetch existing global commands to preserve Entry Point
    const existing = await rest.get(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID));
    const entryPoint = existing.filter(c => c.type === 4); // type 4 = PRIMARY_ENTRY_POINT
    const body = [...cmdData, ...entryPoint];

    if (process.env.DISCORD_GUILD_ID) {
      // Guild commands register instantly — use for dev
      await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), { body: cmdData });
      console.log(`Registered ${cmdData.length} guild commands`);
    } else {
      await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body });
      console.log(`Registered ${cmdData.length} global commands (+ ${entryPoint.length} entry point preserved)`);
    }
  } catch (e) { console.error('Failed to register commands:', e.message); }
});

// ── Command handler ──
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  try {
    switch (commandName) {
      // ═══ Server Status ═══
      case 'status': {
        const running = isServerRunning();
        const proc = running ? getProcessInfo() : null;
        const embed = new EmbedBuilder()
          .setTitle('⚔ GRUDGE EXILES — Server Status')
          .setColor(running ? COLORS.green : COLORS.red)
          .addFields(
            { name: 'Status', value: running ? '🟢 **ONLINE**' : '🔴 **OFFLINE**', inline: true },
            { name: 'Connect', value: '`76.31.186.50:7777`', inline: true },
          );
        if (proc) {
          embed.addFields(
            { name: 'Memory', value: `${proc.MemMB} MB`, inline: true },
            { name: 'PID', value: `${proc.Id}`, inline: true },
          );
          if (proc.StartTime) {
            const mins = Math.round((Date.now() - new Date(proc.StartTime)) / 60000);
            embed.addFields({ name: 'Uptime', value: mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`, inline: true });
          }
        }
        // Try to get player count
        if (running) {
          try {
            const plist = await rcon('listplayers');
            const count = plist.trim() ? plist.trim().split('\n').length : 0;
            embed.addFields({ name: 'Players', value: `${count}/40`, inline: true });
          } catch {}
        }
        return interaction.reply({ embeds: [embed] });
      }

      case 'players': {
        if (!isServerRunning()) return interaction.reply({ content: '🔴 Server is offline.', ephemeral: true });
        try {
          const list = await rcon('listplayers');
          const embed = new EmbedBuilder()
            .setTitle('👥 Online Players')
            .setColor(COLORS.blue)
            .setDescription(list.trim() || '*No players online*');
          return interaction.reply({ embeds: [embed] });
        } catch (e) {
          return interaction.reply({ content: `RCON error: ${e.message}`, ephemeral: true });
        }
      }

      case 'serverinfo': {
        const embed = new EmbedBuilder()
          .setTitle('⚔ GRUDGE EXILES — Server Info')
          .setColor(COLORS.red)
          .setDescription('**DoTs Kill, Swords Don\'t** — Full Loot PVP')
          .addFields(
            { name: '🔗 Direct Connect', value: '`76.31.186.50:7777`' },
            { name: '🌐 Admin Panel', value: '[conan.grudge-studio.com](https://conan.grudge-studio.com)' },
            { name: '⚔ Balance', value: '• Weapon damage: **0.25x** (DoTs are king)\n• Harvest: **3x**\n• XP: **3x** all sources\n• Pets: **2x damage**, **0.5x taken**' },
            { name: '💀 Loot', value: 'Full loot on death — everyone can loot corpses' },
            { name: '🐾 Followers', value: 'Max 2 thralls/pets following' },
            { name: '🔧 Crafting', value: '0.5x craft time, 3x craft XP' },
          )
          .setFooter({ text: 'Created by Racalvin The Pirate King — Grudge Studio' });
        return interaction.reply({ embeds: [embed] });
      }

      case 'rules': {
        const embed = new EmbedBuilder()
          .setTitle('📜 Server Rules')
          .setColor(COLORS.yellow)
          .setDescription(
            '**1.** No exploits, glitches, or undermesh building\n' +
            '**2.** PVP is always on — fight or die\n' +
            '**3.** Full loot — gear at your own risk\n' +
            '**4.** No foundation spam or blocking resources\n' +
            '**5.** Raid windows: anytime (24/7 PVP)\n' +
            '**6.** Max clan size: 10\n' +
            '**7.** DoTs are the meta — adapt or perish\n' +
            '**8.** Respect other players in chat\n' +
            '**9.** Admin decisions are final\n'
          );
        return interaction.reply({ embeds: [embed] });
      }

      // ═══ Admin: Server Control ═══
      case 'start': {
        if (isServerRunning()) return interaction.reply({ content: '⚠ Server is already running.', ephemeral: true });
        await interaction.deferReply();
        spawn(SERVER_EXE, ['-log'], { cwd: CONAN_DIR, detached: true, stdio: 'ignore' }).unref();
        return interaction.editReply('🟢 Server starting... allow 30-60 seconds for full boot.');
      }

      case 'stop': {
        if (!isServerRunning()) return interaction.reply({ content: '⚠ Server is not running.', ephemeral: true });
        await interaction.deferReply();
        try { await rcon('broadcast Server shutting down in 10 seconds!'); } catch {}
        await new Promise(r => setTimeout(r, 10000));
        try { execSync('taskkill /IM ConanSandboxServer-Win64-Shipping.exe /F'); } catch {}
        try { execSync('taskkill /IM ConanSandboxServer.exe /F'); } catch {}
        return interaction.editReply('🔴 Server stopped.');
      }

      case 'restart': {
        await interaction.deferReply();
        try { await rcon('broadcast Server restarting in 15 seconds!'); } catch {}
        await new Promise(r => setTimeout(r, 15000));
        if (isServerRunning()) {
          try { execSync('taskkill /IM ConanSandboxServer-Win64-Shipping.exe /F'); } catch {}
          try { execSync('taskkill /IM ConanSandboxServer.exe /F'); } catch {}
        }
        await new Promise(r => setTimeout(r, 5000));
        spawn(SERVER_EXE, ['-log'], { cwd: CONAN_DIR, detached: true, stdio: 'ignore' }).unref();
        return interaction.editReply('🔄 Server restarting... allow 30-60 seconds for full boot.');
      }

      case 'broadcast': {
        const msg = interaction.options.getString('message');
        try {
          await rcon(`broadcast ${msg}`);
          return interaction.reply(`📢 Broadcasted: **${msg}**`);
        } catch (e) {
          return interaction.reply({ content: `RCON error: ${e.message}`, ephemeral: true });
        }
      }

      case 'rcon': {
        const cmd = interaction.options.getString('command');
        await interaction.deferReply({ ephemeral: true });
        try {
          const response = await rcon(cmd);
          return interaction.editReply(`\`\`\`\n> ${cmd}\n${response || '(no response)'}\n\`\`\``);
        } catch (e) {
          return interaction.editReply(`RCON error: ${e.message}`);
        }
      }

      case 'kick': {
        const player = interaction.options.getString('player');
        try {
          await rcon(`kick ${player}`);
          return interaction.reply(`👢 Kicked: **${player}**`);
        } catch (e) {
          return interaction.reply({ content: `Error: ${e.message}`, ephemeral: true });
        }
      }

      case 'ban': {
        const player = interaction.options.getString('player');
        try {
          await rcon(`ban ${player}`);
          return interaction.reply(`🔨 Banned: **${player}**`);
        } catch (e) {
          return interaction.reply({ content: `Error: ${e.message}`, ephemeral: true });
        }
      }

      case 'unban': {
        const player = interaction.options.getString('player');
        try {
          await rcon(`unban ${player}`);
          return interaction.reply(`✅ Unbanned: **${player}**`);
        } catch (e) {
          return interaction.reply({ content: `Error: ${e.message}`, ephemeral: true });
        }
      }

      // ═══ Home System ═══
      case 'sethome': {
        const name = interaction.options.getString('name').toLowerCase();
        const x = interaction.options.getNumber('x');
        const y = interaction.options.getNumber('y');
        const z = interaction.options.getNumber('z');
        const homes = load(HOMES_FILE);
        const uid = interaction.user.id;
        if (!homes[uid]) homes[uid] = {};
        if (Object.keys(homes[uid]).length >= 5) return interaction.reply({ content: '❌ Max 5 homes. Delete one first with `/delhome`.', ephemeral: true });
        homes[uid][name] = { x, y, z, set: Date.now() };
        save(HOMES_FILE, homes);
        return interaction.reply({ content: `🏠 Home **${name}** saved at \`${x}, ${y}, ${z}\``, ephemeral: true });
      }

      case 'home': {
        const name = interaction.options.getString('name').toLowerCase();
        const homes = load(HOMES_FILE);
        const uid = interaction.user.id;
        if (!homes[uid]?.[name]) return interaction.reply({ content: `❌ No home named **${name}**. Check \`/homes\`.`, ephemeral: true });
        const h = homes[uid][name];
        // Get linked Steam ID
        const players = load(PLAYERS_FILE);
        if (!players[uid]) return interaction.reply({ content: '❌ Link your Steam ID first with `/link <steamid>`.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          await rcon(`con TeleportPlayer ${h.x} ${h.y} ${h.z}`);
          return interaction.editReply(`🏠 Teleporting to **${name}** (\`${h.x}, ${h.y}, ${h.z}\`)\n⚠ *You must be the admin character in-game, or use the admin panel to target teleport.*`);
        } catch (e) {
          return interaction.editReply(`RCON error: ${e.message}`);
        }
      }

      case 'delhome': {
        const name = interaction.options.getString('name').toLowerCase();
        const homes = load(HOMES_FILE);
        const uid = interaction.user.id;
        if (!homes[uid]?.[name]) return interaction.reply({ content: `❌ No home named **${name}**.`, ephemeral: true });
        delete homes[uid][name];
        save(HOMES_FILE, homes);
        return interaction.reply({ content: `🗑️ Home **${name}** deleted.`, ephemeral: true });
      }

      case 'homes': {
        const homes = load(HOMES_FILE);
        const uid = interaction.user.id;
        const userHomes = homes[uid] || {};
        if (Object.keys(userHomes).length === 0) return interaction.reply({ content: '📍 No homes saved. Use `/sethome` to create one.', ephemeral: true });
        const list = Object.entries(userHomes).map(([n, h]) => `🏠 **${n}** — \`${h.x}, ${h.y}, ${h.z}\``).join('\n');
        const embed = new EmbedBuilder()
          .setTitle('🏠 Your Homes')
          .setColor(COLORS.blue)
          .setDescription(list)
          .setFooter({ text: `${Object.keys(userHomes).length}/5 homes used` });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // ═══ Warp System ═══
      case 'warp': {
        const name = interaction.options.getString('name').toLowerCase();
        const warps = load(WARPS_FILE);
        if (!warps[name]) return interaction.reply({ content: `❌ No warp **${name}**. See \`/warps\`.`, ephemeral: true });
        const w = warps[name];
        await interaction.deferReply({ ephemeral: true });
        try {
          await rcon(`con TeleportPlayer ${w.x} ${w.y} ${w.z}`);
          return interaction.editReply(`🌀 Warping to **${name}** (\`${w.x}, ${w.y}, ${w.z}\`)\n📍 ${w.desc || ''}`);
        } catch (e) {
          return interaction.editReply(`RCON error: ${e.message}`);
        }
      }

      case 'warps': {
        const warps = load(WARPS_FILE);
        if (Object.keys(warps).length === 0) return interaction.reply('No warps defined.');
        const list = Object.entries(warps).map(([n, w]) => `🌀 **${n}** — ${w.desc || 'No description'}\n   \`${w.x}, ${w.y}, ${w.z}\``).join('\n\n');
        const embed = new EmbedBuilder()
          .setTitle('🌀 Available Warps')
          .setColor(COLORS.purple)
          .setDescription(list);
        return interaction.reply({ embeds: [embed] });
      }

      case 'setwarp': {
        const name = interaction.options.getString('name').toLowerCase();
        const x = interaction.options.getNumber('x');
        const y = interaction.options.getNumber('y');
        const z = interaction.options.getNumber('z');
        const desc = interaction.options.getString('description') || '';
        const warps = load(WARPS_FILE);
        warps[name] = { x, y, z, desc };
        save(WARPS_FILE, warps);
        return interaction.reply(`🌀 Warp **${name}** set at \`${x}, ${y}, ${z}\``);
      }

      case 'delwarp': {
        const name = interaction.options.getString('name').toLowerCase();
        const warps = load(WARPS_FILE);
        if (!warps[name]) return interaction.reply({ content: `❌ No warp **${name}**.`, ephemeral: true });
        delete warps[name];
        save(WARPS_FILE, warps);
        return interaction.reply(`🗑️ Warp **${name}** deleted.`);
      }

      // ═══ Custom Spawn ═══
      case 'setspawn': {
        const x = interaction.options.getNumber('x');
        const y = interaction.options.getNumber('y');
        const z = interaction.options.getNumber('z');
        save(SPAWNS_FILE, { x, y, z });
        return interaction.reply(`📍 Custom spawn set to \`${x}, ${y}, ${z}\`. New players can use \`/spawn\` to teleport here.`);
      }

      case 'spawn': {
        const spawnData = load(SPAWNS_FILE);
        if (!spawnData.x) return interaction.reply({ content: '❌ No custom spawn set. Ask an admin to use `/setspawn`.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          await rcon(`con TeleportPlayer ${spawnData.x} ${spawnData.y} ${spawnData.z}`);
          return interaction.editReply(`📍 Teleporting to spawn (\`${spawnData.x}, ${spawnData.y}, ${spawnData.z}\`)`);
        } catch (e) {
          return interaction.editReply(`RCON error: ${e.message}`);
        }
      }

      // ═══ Admin Teleport ═══
      case 'tp': {
        const player = interaction.options.getString('player');
        const x = interaction.options.getNumber('x');
        const y = interaction.options.getNumber('y');
        const z = interaction.options.getNumber('z');
        await interaction.deferReply({ ephemeral: true });
        try {
          // Teleport via RCON — targets the admin console character
          await rcon(`con TeleportPlayer ${x} ${y} ${z}`);
          return interaction.editReply(`🔮 Teleport command sent: **${player}** → \`${x}, ${y}, ${z}\``);
        } catch (e) {
          return interaction.editReply(`RCON error: ${e.message}`);
        }
      }

      case 'tpto': {
        const player = interaction.options.getString('player');
        await interaction.deferReply({ ephemeral: true });
        try {
          await rcon(`con TeleportToPlayer ${player}`);
          return interaction.editReply(`🔮 Teleporting to **${player}**`);
        } catch (e) {
          return interaction.editReply(`RCON error: ${e.message}`);
        }
      }

      // ═══ Steam Link ═══
      case 'link': {
        const steamId = interaction.options.getString('steamid');
        const players = load(PLAYERS_FILE);
        players[interaction.user.id] = { steamId, linked: Date.now(), name: interaction.user.username };
        save(PLAYERS_FILE, players);
        return interaction.reply({ content: `🔗 Linked Discord to Steam ID \`${steamId}\``, ephemeral: true });
      }

      case 'unlink': {
        const players = load(PLAYERS_FILE);
        delete players[interaction.user.id];
        save(PLAYERS_FILE, players);
        return interaction.reply({ content: '🔓 Steam ID unlinked.', ephemeral: true });
      }

      // ═══ MOTD ═══
      case 'motd': {
        const { generateMOTD } = require('./motd');
        const motd = generateMOTD();
        const embed = new EmbedBuilder()
          .setTitle('📜 Message of the Day')
          .setColor(COLORS.yellow)
          .setDescription(motd.raw)
          .addFields({ name: 'Theme', value: motd.theme, inline: true }, { name: 'Date', value: motd.date, inline: true })
          .setFooter({ text: 'Changes daily at midnight | conan.grudge-studio.com' });
        return interaction.reply({ embeds: [embed] });
      }

      case 'refreshmotd': {
        const { updateMOTD } = require('./motd');
        await interaction.deferReply();
        const motd = await updateMOTD();
        return interaction.editReply(`📜 MOTD updated: **${motd.raw}** [${motd.theme}]`);
      }

      // ═══ Settings Display ═══
      case 'settings': {
        const ini = require('ini');
        const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
        const cfg = ini.parse(raw).ServerSettings || {};
        const embed = new EmbedBuilder()
          .setTitle('⚙ Server Balance Settings')
          .setColor(COLORS.yellow)
          .addFields(
            { name: '⚔ Combat', value:
              `Player Damage: **${cfg.PlayerDamageMultiplier || 1}x**\n` +
              `NPC Damage: **${cfg.NPCDamageMultiplier || 1}x**\n` +
              `NPC Health: **${cfg.NPCHealthMultiplier || 1}x**\n` +
              `Friendly Fire: **${cfg.FriendlyFireDamageMultiplier || 0.25}x**`, inline: true },
            { name: '🐾 Followers', value:
              `Pet Damage: **${cfg.PetDamageMultiplier || 1}x**\n` +
              `Pet Taken: **${cfg.PetDamageTakenMultiplier || 1}x**\n` +
              `Thrall→Player: **${cfg.ThrallDamageToPlayersMultiplier || 1}x**\n` +
              `Max Following: **${cfg.MaxFollowingThralls || 1}**`, inline: true },
            { name: '📦 Rates', value:
              `Harvest: **${cfg.HarvestAmountMultiplier || 1}x**\n` +
              `XP Rate: **${cfg.PlayerXPRateMultiplier || 1}x**\n` +
              `Craft Time: **${cfg.CraftingTimeMultiplier || 1}x**\n` +
              `Spoil Rate: **${cfg.ItemSpoilRateScale || 1}x**`, inline: true },
            { name: '💀 Death', value:
              `Drop Gear: **${cfg.DropEquipmentOnDeath === 'True' ? 'Yes' : 'No'}**\n` +
              `Loot Corpses: **${cfg.EverybodyCanLootCorpse === 'True' ? 'Anyone' : 'Owner'}**\n` +
              `Corpse Timer: **${Math.round((cfg.PlayerCorpseLifeTime || 1800) / 60)}min**`, inline: true },
          )
          .setFooter({ text: 'Change via admin panel: conan.grudge-studio.com' });
        return interaction.reply({ embeds: [embed] });
      }

      // ═══ Kits ═══
      case 'kit': {
        const player = interaction.options.getString('player');
        const kitName = interaction.options.getString('kit');
        const items = KITS[kitName];
        if (!items) return interaction.reply({ content: '❌ Unknown kit.', ephemeral: true });
        await interaction.deferReply();
        const results = [];
        for (const item of items) {
          try {
            await rcon(`con SpawnItem ${item.id} ${item.qty}`);
            results.push(`✅ ${item.name} x${item.qty}`);
          } catch {
            results.push(`❌ ${item.name} — failed`);
          }
        }
        const embed = new EmbedBuilder()
          .setTitle(`🎁 Kit: ${kitName}`)
          .setColor(COLORS.green)
          .setDescription(`Given to **${player}**:\n${results.join('\n')}`);
        return interaction.editReply({ embeds: [embed] });
      }

      default:
        return interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (e) {
    console.error(`Command error [${commandName}]:`, e);
    const reply = { content: `❌ Error: ${e.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) return interaction.editReply(reply);
    return interaction.reply(reply);
  }
});

// ── Login ──
client.login(process.env.DISCORD_TOKEN);
