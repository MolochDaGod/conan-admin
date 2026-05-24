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
    const c = net.connect(port, host, () => c.write(rconPacket(1, 3, pw)));
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

// ── Bot admin puppet character (always-online invisible admin for teleports) ──
const BOT_ADMIN_CHAR = process.env.BOT_ADMIN_CHAR || 'ale';

// ── A2S Steam Server Query (keyless UDP, port 27015) ──
const dgram = require('dgram');
const SERVER_IP = '76.31.186.50';
const QUERY_PORT = 27015;
const STEAM_CONNECT = `steam://connect/${SERVER_IP}:7777`;
const AVATAR_URL = 'https://conan.grudge-studio.com/img/hero.jpg';

function a2sQuery() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    // A2S_INFO request: FF FF FF FF 54 Source Engine Query\0
    const req = Buffer.from('ffffffff54536f7572636520456e67696e6520517565727900', 'hex');
    sock.send(req, 0, req.length, QUERY_PORT, '10.0.0.56');
    sock.on('message', (msg) => {
      try {
        // Check for challenge response (0x41) — Enhanced uses this
        if (msg.length >= 9 && msg[4] === 0x41) {
          const challenge = msg.slice(5, 9);
          const req2 = Buffer.concat([Buffer.from('ffffffff54536f7572636520456e67696e6520517565727900', 'hex'), challenge]);
          sock.send(req2, 0, req2.length, QUERY_PORT, '10.0.0.56');
          return;
        }
        if (msg[4] !== 0x49) { sock.close(); return resolve(null); } // not A2S_INFO response
        let off = 6; // skip header + protocol
        const readStr = () => { const start = off; while (msg[off] !== 0) off++; return msg.toString('utf8', start, off++); };
        const name = readStr();
        const map = readStr();
        const folder = readStr();
        const game = readStr();
        const steamAppId = msg.readUInt16LE(off); off += 2;
        const players = msg[off++];
        const maxPlayers = msg[off++];
        const bots = msg[off++];
        sock.close();
        resolve({ name, map, folder, game, steamAppId, players, maxPlayers, bots });
      } catch (e) { sock.close(); resolve(null); }
    });
    sock.on('error', () => { sock.close(); resolve(null); });
    setTimeout(() => { try { sock.close(); } catch {} resolve(null); }, 3000);
  });
}

// ── Online player cache (polls listplayers every 60s) ──
// Each entry: { idx, charName, playerName, userId, platformId, platform }
let onlinePlayers = [];
const ONLINE_CACHE_FILE = path.join(DATA_DIR, 'online-players.json');

function parsePlayerList(raw) {
  if (!raw || !raw.trim()) return [];
  const lines = raw.trim().split('\n');
  const players = [];
  for (const line of lines) {
    // Skip header line
    if (line.includes('Idx') && line.includes('Char name')) continue;
    // Format: "  0 | Racalvin Pirate King | TheAnteater#70957 | A-1250C4VC02 | 76561198113644718 | STEAM"
    const parts = line.split('|').map(s => s.trim());
    if (parts.length >= 6) {
      players.push({
        idx: parseInt(parts[0]) || 0,
        charName: parts[1],
        playerName: parts[2],
        userId: parts[3],
        platformId: parts[4],
        platform: parts[5],
      });
    }
  }
  return players;
}

// Known players registry — maps charName → full player info (persists across restarts)
const KNOWN_PLAYERS_FILE = path.join(DATA_DIR, 'known-players.json');

async function refreshOnlineCache() {
  if (!isServerRunning()) { onlinePlayers = []; return; }
  try {
    const raw = await rcon('listplayers');
    onlinePlayers = parsePlayerList(raw);
    save(ONLINE_CACHE_FILE, { updated: Date.now(), players: onlinePlayers });
    // Auto-register every online player's userId for future teleport commands
    if (onlinePlayers.length > 0) {
      const known = load(KNOWN_PLAYERS_FILE);
      let changed = false;
      for (const p of onlinePlayers) {
        const key = p.charName.toLowerCase();
        if (!known[key] || known[key].userId !== p.userId) {
          known[key] = { userId: p.userId, charName: p.charName, playerName: p.playerName, platformId: p.platformId, platform: p.platform, lastSeen: Date.now() };
          changed = true;
        }
      }
      if (changed) save(KNOWN_PLAYERS_FILE, known);
    }
  } catch {
    // Keep stale cache on RCON failure
  }
}

// Look up a player's userId from any source: linked players.json, known-players.json, or online cache
function resolveUserId(charNameOrDiscordId) {
  // Check linked Discord players first
  const linked = load(PLAYERS_FILE);
  if (linked[charNameOrDiscordId]?.userId) return linked[charNameOrDiscordId].userId;
  // Check by charName in linked
  for (const v of Object.values(linked)) {
    if (v.charName && v.charName.toLowerCase() === charNameOrDiscordId.toLowerCase()) return v.userId;
  }
  // Check known players registry
  const known = load(KNOWN_PLAYERS_FILE);
  const knownEntry = known[charNameOrDiscordId.toLowerCase()];
  if (knownEntry?.userId) return knownEntry.userId;
  // Check live online cache
  const online = onlinePlayers.find(p => p.charName.toLowerCase() === charNameOrDiscordId.toLowerCase());
  if (online) return online.userId;
  return null;
}

// Find a player in cache by character name (case-insensitive, partial match)
function findOnlinePlayer(query) {
  const q = query.toLowerCase();
  // Exact match first
  const exact = onlinePlayers.find(p => p.charName.toLowerCase() === q);
  if (exact) return exact;
  // Partial match
  return onlinePlayers.find(p => p.charName.toLowerCase().includes(q));
}

// Resolve a Discord user's linked Steam ID
function getLinkedSteamId(discordUserId) {
  const players = load(PLAYERS_FILE);
  return players[discordUserId]?.steamId || null;
}

// ── Game DB — read player positions directly from SQLite (readonly, concurrent-safe) ──
const GAME_DB_PATH = path.join(CONAN_DIR, 'ConanSandbox', 'Saved', 'game_0.db');
const Database = require('better-sqlite3');

function getPlayerPosition(charName) {
  try {
    const db = new Database(GAME_DB_PATH, { readonly: true, fileMustExist: true });
    const row = db.prepare(`
      SELECT c.char_name, c.id, ap.x, ap.y, ap.z
      FROM characters c
      JOIN actor_position ap ON c.id = ap.id
      WHERE LOWER(c.char_name) = LOWER(?)
    `).get(charName);
    db.close();
    return row ? { charName: row.char_name, x: Math.round(row.x), y: Math.round(row.y), z: Math.round(row.z) } : null;
  } catch (e) {
    console.log('[GameDB] Error reading position:', e.message);
    return null;
  }
}

function getAllPlayerPositions() {
  try {
    const db = new Database(GAME_DB_PATH, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      SELECT c.char_name, c.playerId, ap.x, ap.y, ap.z
      FROM characters c
      JOIN actor_position ap ON c.id = ap.id
      WHERE c.isAlive = 1
    `).all();
    db.close();
    return rows.map(r => ({ charName: r.char_name, playerId: r.playerId, x: Math.round(r.x), y: Math.round(r.y), z: Math.round(r.z) }));
  } catch { return []; }
}

// ── Embed colors ──
const COLORS = { red: 0xc0392b, green: 0x27ae60, yellow: 0xf39c12, blue: 0x3498db, purple: 0x9b59b6, gold: 0xd4af37 };

// ── Webhook edit-or-create helper ──
// Tracks message IDs so we PATCH existing messages instead of spamming new ones
const WEBHOOK_MSG_FILE = path.join(DATA_DIR, 'webhook-messages.json');
const https = require('https');

function getWebhookIds() {
  const webhookUrl = process.env.DISCORD_CONAN_WEBHOOK;
  if (!webhookUrl) return null;
  const m = webhookUrl.match(/\/webhooks\/(\d+)\/([\w-]+)/);
  if (!m) return null;
  return { id: m[1], token: m[2] };
}

function webhookRequest(method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'discord.com', path: urlPath, method, headers: { 'Content-Type': 'application/json' } };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(opts, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body || '{}') }); }
        catch { resolve({ status: res.statusCode, data: {} }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function webhookEditOrCreate(key, payload) {
  const wh = getWebhookIds();
  if (!wh) return;
  const stored = load(WEBHOOK_MSG_FILE);
  const msgId = stored[key];
  const json = JSON.stringify({ username: 'GRUDGE EXILES', avatar_url: AVATAR_URL, ...payload });

  // Try to edit existing message
  if (msgId) {
    const res = await webhookRequest('PATCH', `/api/webhooks/${wh.id}/${wh.token}/messages/${msgId}`, json);
    if (res.status === 200) return; // edited successfully
    // Message was deleted — fall through to create
  }

  // Create new message
  const res = await webhookRequest('POST', `/api/webhooks/${wh.id}/${wh.token}?wait=true`, json);
  if (res.status === 200 && res.data.id) {
    stored[key] = res.data.id;
    save(WEBHOOK_MSG_FILE, stored);
  }
}

// ── Shop / Kit system (dynamic, loaded from data/shop.json) ──
const SHOP_FILE = path.join(DATA_DIR, 'shop.json');
const DEFAULT_SHOP = [
  { id: 'starter', name: 'Starter Kit', description: 'Stone tools + fiber', emoji: '🏕', category: 'starter', price: 0, enabled: true, items: [
    { id: 51001, qty: 1, name: 'Stone Hatchet' }, { id: 51002, qty: 1, name: 'Stone Pick' },
    { id: 11502, qty: 50, name: 'Plant Fiber' }, { id: 11001, qty: 50, name: 'Stone' },
    { id: 11101, qty: 30, name: 'Wood' }, { id: 13005, qty: 5, name: 'Waterskin' },
  ]},
  { id: 'builder', name: 'Builder Pack', description: 'T2 building materials', emoji: '🏗', category: 'building', price: 0, enabled: true, items: [
    { id: 11108, qty: 500, name: 'Shaped Wood' }, { id: 11009, qty: 500, name: 'Brick' },
    { id: 11058, qty: 200, name: 'Iron Reinforcement' }, { id: 11502, qty: 200, name: 'Twine' },
  ]},
  { id: 'warrior', name: 'Warrior Pack', description: 'Iron weapons + medium armor', emoji: '⚔', category: 'combat', price: 0, enabled: true, items: [
    { id: 51011, qty: 1, name: 'Iron Broadsword' }, { id: 51301, qty: 1, name: 'Iron Shield' },
    { id: 52003, qty: 1, name: 'Medium Chest' }, { id: 52004, qty: 1, name: 'Medium Gauntlets' },
    { id: 52005, qty: 1, name: 'Medium Leggings' }, { id: 52006, qty: 1, name: 'Medium Boots' },
    { id: 18100, qty: 20, name: 'Aloe Soup' },
  ]},
  { id: 'alchemist', name: 'Alchemist Pack', description: 'Potions + ingredients', emoji: '🧪', category: 'alchemy', price: 0, enabled: true, items: [
    { id: 18060, qty: 20, name: 'Aloe Extract' }, { id: 18301, qty: 10, name: 'Set Antidote' },
    { id: 18052, qty: 10, name: 'Healing Waterskin' }, { id: 14180, qty: 50, name: 'Yellow Lotus Blossom' },
    { id: 14181, qty: 20, name: 'Alchemical Base' },
  ]},
];

function loadShop() {
  if (!fs.existsSync(SHOP_FILE)) { save(SHOP_FILE, DEFAULT_SHOP); return DEFAULT_SHOP; }
  return load(SHOP_FILE, DEFAULT_SHOP);
}

function getKit(kitId) {
  const shop = loadShop();
  const pkg = shop.find(p => p.id === kitId && p.enabled);
  return pkg ? pkg.items : null;
}

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
    .setDescription('Save your current in-game position as a home (must be online)')
    .addStringOption(o => o.setName('name').setDescription('Home name').setRequired(true)),
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

  // Link character
  new SlashCommandBuilder().setName('link')
    .setDescription('Link your Discord to your in-game character (must be online)')
    .addStringOption(o => o.setName('character').setDescription('Your in-game character name').setRequired(true)),
  new SlashCommandBuilder().setName('unlink').setDescription('Unlink your character'),
  new SlashCommandBuilder().setName('whoami').setDescription('Show your linked character info'),

  // MOTD
  new SlashCommandBuilder().setName('motd').setDescription('Show today\'s message of the day'),
  new SlashCommandBuilder().setName('refreshmotd').setDescription('Force refresh the MOTD now')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Wipe state management
  new SlashCommandBuilder().setName('wipesave').setDescription('Save current world as the wipe template (preserves map rooms)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('wiperestore').setDescription('Wipe server and restore from saved template')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('wipeinfo').setDescription('Show wipe state info'),

  // Map & Connect
  new SlashCommandBuilder().setName('map').setDescription('Interactive Exiled Lands map with one-click warp buttons'),
  new SlashCommandBuilder().setName('connect').setDescription('Get a one-click link to join the server'),

  // Utility
  new SlashCommandBuilder().setName('settings').setDescription('Show current server balance settings'),
  new SlashCommandBuilder().setName('shop').setDescription('View available kits and packages'),
  new SlashCommandBuilder().setName('kit')
    .setDescription('Grant a kit/package to a player (admin)')
    .addStringOption(o => o.setName('player').setDescription('Player Steam ID').setRequired(true))
    .addStringOption(o => o.setName('kit').setDescription('Kit ID (use /shop to see available)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

// Kits are now loaded dynamically from data/shop.json — see loadShop() above

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

  // Server heartbeat — stylized embed, always at bottom of channel
  const HEARTBEAT_CHANNEL = '1394826401311625306';
  async function heartbeat() {
    const running = isServerRunning();
    const proc = running ? getProcessInfo() : null;
    let playerCount = '?';
    if (running) { try { const pl = await rcon('listplayers'); playerCount = pl.trim() ? pl.trim().split('\n').length : 0; } catch { playerCount = '?'; } }
    const uptime = (proc && proc.StartTime) ? (() => { const m = Math.round((Date.now() - new Date(proc.StartTime)) / 60000); return m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`; })() : 'N/A';

    const embed = new EmbedBuilder()
      .setTitle('⚔ GRUDGE EXILES')
      .setDescription('**Hit Hard, Die Slow** — Full Loot PVP')
      .setColor(running ? 0xd4af37 : 0xc0392b)
      .addFields(
        { name: 'Status', value: running ? '🟢 **ONLINE**' : '🔴 **OFFLINE**', inline: true },
        { name: 'Players', value: `**${playerCount}**/40`, inline: true },
        { name: 'Connect', value: '`76.31.186.50:7777`', inline: true },
        { name: 'Memory', value: proc ? `${proc.MemMB} MB` : 'N/A', inline: true },
        { name: 'Uptime', value: uptime, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '⚔ Balance', value: '`1000 HP` • `40% DR` • `2x` NPC DMG • `3x` Thralls vs Players\n`2.5x` Harvest • `3x` XP • 💀 Full Loot', inline: false },
      )
      .setFooter({ text: `conan.grudge-studio.com • Updated ${new Date().toLocaleTimeString()}` });

    try {
      const channel = await client.channels.fetch(HEARTBEAT_CHANNEL);
      if (!channel) return;

      // Delete old heartbeat message so the new one is always at the bottom
      const stored = load(WEBHOOK_MSG_FILE);
      if (stored.heartbeatMsgId) {
        try { const old = await channel.messages.fetch(stored.heartbeatMsgId); await old.delete(); } catch {}
      }

      // Post fresh message (always newest = always at bottom)
      const msg = await channel.send({ embeds: [embed] });
      stored.heartbeatMsgId = msg.id;
      save(WEBHOOK_MSG_FILE, stored);
    } catch (e) {
      console.log('[Heartbeat] Error:', e.message);
      // Fallback to webhook edit if channel send fails
      try { await webhookEditOrCreate('heartbeat', { embeds: [embed.toJSON()] }); } catch {}
    }
  }
  heartbeat();
  setInterval(heartbeat, 300000);

  // Online player cache — refresh every 60s
  refreshOnlineCache();
  setInterval(refreshOnlineCache, 60000);
  console.log('[PlayerCache] Started polling every 60s');

  // Initialize bot admin puppet character (invisible + god mode)
  console.log(`[Bot] Admin puppet character: ${BOT_ADMIN_CHAR}`);
  try {
    await rcon(`con MakeMeInvisible`);
    await rcon(`con God`);
    console.log(`[Bot] ${BOT_ADMIN_CHAR} set to invisible + god mode`);
  } catch (e) {
    console.log(`[Bot] Could not set ${BOT_ADMIN_CHAR} invisible (may need to be online):`, e.message);
  }

  // Start in-game chat log watcher (bridges !sethome, !home, !warp from in-game to bot)
  const { startWatcher } = require('./logwatcher');
  startWatcher(rcon, client);

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

// ── Warp button emojis ──
const WARP_EMOJIS = {
  'dregs': '🐉', 'sinkhole': '🕳️', 'unnamed-city': '🏚️', 'shattered': '💨',
  'dagons-eye': '🐚', 'staging-area': '🌴', 'black-keep': '🏰', 'temple-frost': '❄️',
  'mounds': '💀', 'volcano': '🌋', 'sorcery-cave': '🔮',
};

// ── Button interaction handler (warp map clicks) ──
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const id = interaction.customId;
  if (!id.startsWith('warp:')) return;

  const warpName = id.slice(5); // strip 'warp:'
  const warps = load(WARPS_FILE);
  const w = warps[warpName];
  if (!w) return interaction.reply({ content: `❌ Warp **${warpName}** no longer exists.`, ephemeral: true });

  // Find the player's userId
  const linked = load(PLAYERS_FILE)[interaction.user.id];
  const userId = linked?.userId || resolveUserId(linked?.charName || '');
  if (!userId) {
    return interaction.reply({ content: '❌ Link your character first with `/link <character name>` while in-game.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await rcon(`con ${userId} TeleportPlayer ${w.x} ${w.y} ${w.z}`);
    if (result.includes('Couldn')) {
      return interaction.editReply(`❌ You must be online in-game to warp.`);
    }
    return interaction.editReply(`🌀 Warped to **${warpName}**! ${w.desc || ''}`);
  } catch (e) {
    return interaction.editReply(`❌ RCON error: ${e.message}`);
  }
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
          .setDescription('**Hit Hard, Die Slow** — Full Loot PVP')
          .addFields(
            { name: '🔗 Direct Connect', value: '`76.31.186.50:7777`' },
            { name: '🌐 Admin Panel', value: '[conan.grudge-studio.com](https://conan.grudge-studio.com)' },
            { name: '⚔ Balance', value: '• Player HP: **1000** (5x)\n• Damage taken: **0.6x** (40% DR)\n• NPC damage: **2x**\n• Harvest: **2.5x** \u2022 XP: **3x**' },
            { name: '🐾 Thralls', value: '• vs Players: **3x** \u2022 vs NPCs: **0.8x**\n• Follower DR: **40%** \u2022 Taming: **2x** faster' },
            { name: '💀 Loot', value: 'Full loot on death — everyone can loot corpses' },
            { name: '🔧 Crafting', value: '0.5x cost, 2x speed, 3x craft XP' },
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
        const linked = load(PLAYERS_FILE)[interaction.user.id];
        if (!linked) return interaction.reply({ content: '❌ Link your character first with `/link <character name>`.', ephemeral: true });
        const pos = getPlayerPosition(linked.charName);
        if (!pos) return interaction.reply({ content: '❌ Could not read your position. Make sure you\'re in-game.', ephemeral: true });
        const homes = load(HOMES_FILE);
        const uid = interaction.user.id;
        if (!homes[uid]) homes[uid] = {};
        if (Object.keys(homes[uid]).length >= 5) return interaction.reply({ content: '❌ Max 5 homes. Delete one first with `/delhome`.', ephemeral: true });
        homes[uid][name] = { x: pos.x, y: pos.y, z: pos.z, set: Date.now() };
        save(HOMES_FILE, homes);
        return interaction.reply({ content: `🏠 Home **${name}** saved at \`${pos.x}, ${pos.y}, ${pos.z}\``, ephemeral: true });
      }

      case 'home': {
        const name = interaction.options.getString('name').toLowerCase();
        const homes = load(HOMES_FILE);
        const uid = interaction.user.id;
        if (!homes[uid]?.[name]) return interaction.reply({ content: `❌ No home named **${name}**. Check \`/homes\`.`, ephemeral: true });
        const h = homes[uid][name];
        const players = load(PLAYERS_FILE);
        if (!players[uid]) return interaction.reply({ content: '❌ Link your character first with `/link <character name>`.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          await rcon(`con ${players[uid].userId} TeleportPlayer ${h.x} ${h.y} ${h.z}`);
          return interaction.editReply(`🏠 Teleporting you to **${name}** (\`${h.x}, ${h.y}, ${h.z}\`)`);
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
        const players2 = load(PLAYERS_FILE);
        const uid2 = interaction.user.id;
        if (!players2[uid2]) return interaction.reply({ content: '❌ Link your character first with `/link <character name>`.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          await rcon(`con ${players2[uid2].userId} TeleportPlayer ${w.x} ${w.y} ${w.z}`);
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
        const players3 = load(PLAYERS_FILE);
        const uid3 = interaction.user.id;
        if (!players3[uid3]) return interaction.reply({ content: '❌ Link your character first with `/link <character name>`.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          await rcon(`con ${players3[uid3].userId} TeleportPlayer ${spawnData.x} ${spawnData.y} ${spawnData.z}`);
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

      // ═══ Interactive Map ═══
      case 'map': {
        const warps = load(WARPS_FILE);
        const warpEntries = Object.entries(warps);
        const a2s = await a2sQuery();
        const playerCount = a2s ? `${a2s.players}/${a2s.maxPlayers}` : `${onlinePlayers.length}/40`;

        const warpList = warpEntries.map(([n, w]) =>
          `${WARP_EMOJIS[n] || '🌀'} **${n}** — ${w.desc || 'No description'}`
        ).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('🗺️ GRUDGE EXILES — Exiled Lands Warp Map')
          .setColor(COLORS.gold)
          .setDescription(`${isServerRunning() ? '🟢' : '🔴'} **${playerCount}** online\n\n**Click a button below to teleport instantly!**\nYou must be in-game and linked (\`/link\`).\n\n${warpList}`)
          .setImage('https://static.wikia.nocookie.net/conanexiles_gamepedia/images/2/2e/Conan_Exiles_Map.jpg')
          .setFooter({ text: 'conan.grudge-studio.com • Warps teleport you directly in-game' });

        // Build button rows (max 5 per row)
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder: AR } = require('discord.js');
        const rows = [];
        let currentRow = new AR();
        warpEntries.forEach(([n], i) => {
          if (i > 0 && i % 5 === 0) { rows.push(currentRow); currentRow = new AR(); }
          currentRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`warp:${n}`)
              .setLabel(n)
              .setStyle(ButtonStyle.Primary)
              .setEmoji(WARP_EMOJIS[n] || '🌀')
          );
        });
        rows.push(currentRow);

        // Add a Join Server link button at the end
        const linkRow = new AR().addComponents(
          new ButtonBuilder().setLabel('Join Server').setStyle(ButtonStyle.Link).setURL(STEAM_CONNECT).setEmoji('⚔'),
          new ButtonBuilder().setLabel('Web Panel').setStyle(ButtonStyle.Link).setURL('https://conan.grudge-studio.com'),
        );
        rows.push(linkRow);

        return interaction.reply({ embeds: [embed], components: rows });
      }

      // ═══ Connect ═══
      case 'connect': {
        const a2s = await a2sQuery();
        const playerCount = a2s ? `${a2s.players}/${a2s.maxPlayers}` : `${onlinePlayers.length}/40`;
        const statusText = isServerRunning() ? '🟢 **ONLINE**' : '🔴 **OFFLINE**';
        const embed = new EmbedBuilder()
          .setTitle('⚔ Join GRUDGE EXILES')
          .setColor(COLORS.red)
          .setDescription(`${statusText} — **${playerCount}** players\n\n**Direct Connect:** \`76.31.186.50:7777\`\n\n[🎮 **Click to Join via Steam**](${STEAM_CONNECT})`)
          .addFields(
            { name: '⚔ Balance', value: '1000 HP • 40% DR • 2x NPC DMG • Full Loot', inline: false },
            { name: '🌐 Web Panel', value: '[conan.grudge-studio.com](https://conan.grudge-studio.com)', inline: true },
          )
          .setFooter({ text: 'Created by Racalvin The Pirate King — Grudge Studio' });
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder: AR } = require('discord.js');
        const row = new AR().addComponents(
          new ButtonBuilder().setLabel('Join Server').setStyle(ButtonStyle.Link).setURL(STEAM_CONNECT).setEmoji('⚔'),
          new ButtonBuilder().setLabel('Web Panel').setStyle(ButtonStyle.Link).setURL('https://conan.grudge-studio.com'),
        );
        return interaction.reply({ embeds: [embed], components: [row] });
      }

      // ═══ Character Link ═══
      case 'link': {
        const charQuery = interaction.options.getString('character');
        // Refresh cache first to get latest player list
        await refreshOnlineCache();
        const match = findOnlinePlayer(charQuery);
        if (!match) {
          const onlineNames = onlinePlayers.map(p => `• **${p.charName}** (${p.playerName})`).join('\n');
          return interaction.reply({
            content: `❌ No online character matching "**${charQuery}**".\nYou must be logged into the server to link.\n\n` +
              (onlineNames ? `**Currently online:**\n${onlineNames}` : '*No players online*'),
            ephemeral: true,
          });
        }
        const players = load(PLAYERS_FILE);
        players[interaction.user.id] = {
          steamId: match.platformId,
          charName: match.charName,
          playerName: match.playerName,
          userId: match.userId,
          platform: match.platform,
          linked: Date.now(),
          discordName: interaction.user.username,
        };
        save(PLAYERS_FILE, players);
        return interaction.reply({
          content: `🔗 Linked! **${match.charName}** (${match.playerName}) → Steam \`${match.platformId}\``,
          ephemeral: true,
        });
      }

      case 'unlink': {
        const players = load(PLAYERS_FILE);
        const existing = players[interaction.user.id];
        delete players[interaction.user.id];
        save(PLAYERS_FILE, players);
        return interaction.reply({ content: existing ? `🔓 Unlinked **${existing.charName || 'character'}**.` : '🔓 Nothing was linked.', ephemeral: true });
      }

      case 'whoami': {
        const players = load(PLAYERS_FILE);
        const linked = players[interaction.user.id];
        if (!linked) return interaction.reply({ content: '❌ Not linked. Log into the server and use `/link <character name>`.', ephemeral: true });
        const isOnline = onlinePlayers.some(p => p.platformId === linked.steamId);
        const embed = new EmbedBuilder()
          .setTitle('🔗 Your Linked Character')
          .setColor(isOnline ? COLORS.green : COLORS.red)
          .addFields(
            { name: 'Character', value: linked.charName || 'Unknown', inline: true },
            { name: 'Player', value: linked.playerName || 'Unknown', inline: true },
            { name: 'Steam ID', value: `\`${linked.steamId}\``, inline: true },
            { name: 'Status', value: isOnline ? '🟢 Online' : '🔴 Offline', inline: true },
            { name: 'Linked', value: `<t:${Math.floor(linked.linked / 1000)}:R>`, inline: true },
          );
        return interaction.reply({ embeds: [embed], ephemeral: true });
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

      // ═══ Wipe State Management ═══
      case 'wipesave': {
        await interaction.deferReply();
        const savedDir = path.join(CONAN_DIR, 'ConanSandbox', 'Saved');
        const wipeDir = 'D:\\backups\\conan\\wipe-state';
        try {
          // Find game databases
          const files = fs.readdirSync(savedDir).filter(f => f.match(/^game.*\.db$/));
          if (files.length === 0) return interaction.editReply('❌ No game databases found.');

          // Create wipe state directory
          fs.mkdirSync(wipeDir, { recursive: true });

          // Copy databases
          const copied = [];
          for (const f of files) {
            const src = path.join(savedDir, f);
            const dst = path.join(wipeDir, f);
            fs.copyFileSync(src, dst);
            const sizeMB = (fs.statSync(src).size / 1048576).toFixed(1);
            copied.push(`${f} (${sizeMB} MB)`);
          }

          // Save metadata
          const meta = { savedAt: new Date().toISOString(), savedBy: interaction.user.username, files: copied };
          fs.writeFileSync(path.join(wipeDir, 'wipe-state.json'), JSON.stringify(meta, null, 2));

          const embed = new EmbedBuilder()
            .setTitle('💾 Wipe State Saved')
            .setColor(COLORS.green)
            .setDescription('Current world snapshot saved as the wipe template.\nMap rooms and admin buildings will survive future wipes.')
            .addFields(
              { name: 'Files', value: copied.join('\n') },
              { name: 'Restore', value: 'Use `/wiperestore` to wipe and restore this state.' },
            )
            .setFooter({ text: `Saved by ${interaction.user.username}` });
          return interaction.editReply({ embeds: [embed] });
        } catch (e) {
          return interaction.editReply(`❌ Failed to save wipe state: ${e.message}`);
        }
      }

      case 'wiperestore': {
        await interaction.deferReply();
        const savedDir2 = path.join(CONAN_DIR, 'ConanSandbox', 'Saved');
        const wipeDir2 = 'D:\\backups\\conan\\wipe-state';
        const preWipeDir = `D:\\backups\\conan\\pre-wipe-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

        try {
          // Verify wipe state exists
          const wipeFiles = fs.readdirSync(wipeDir2).filter(f => f.match(/^game.*\.db$/));
          if (wipeFiles.length === 0) return interaction.editReply('❌ No wipe state found. Use `/wipesave` first.');

          // Read metadata
          let metaInfo = '';
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(wipeDir2, 'wipe-state.json'), 'utf8'));
            metaInfo = `Restoring state from ${meta.savedAt.split('T')[0]} (saved by ${meta.savedBy})`;
          } catch {}

          // Broadcast warning
          try { await rcon('broadcast SERVER WIPE IN 30 SECONDS! Map rooms will be preserved.'); } catch {}
          await interaction.editReply(`⏳ ${metaInfo}\nServer shutting down in 30 seconds for wipe...`);
          await new Promise(r => setTimeout(r, 30000));

          // Stop server
          if (isServerRunning()) {
            try { execSync('taskkill /IM ConanSandboxServer-Win64-Shipping.exe /F'); } catch {}
            try { execSync('taskkill /IM ConanSandboxServer.exe /F'); } catch {}
            await new Promise(r => setTimeout(r, 5000));
          }

          // Pre-wipe backup (safety net)
          fs.mkdirSync(preWipeDir, { recursive: true });
          const currentDbs = fs.readdirSync(savedDir2).filter(f => f.match(/^game.*\.db$/));
          for (const f of currentDbs) {
            fs.copyFileSync(path.join(savedDir2, f), path.join(preWipeDir, f));
          }

          // Delete current databases
          for (const f of currentDbs) {
            fs.unlinkSync(path.join(savedDir2, f));
          }

          // Restore wipe state
          const restored = [];
          for (const f of wipeFiles) {
            fs.copyFileSync(path.join(wipeDir2, f), path.join(savedDir2, f));
            const sizeMB = (fs.statSync(path.join(wipeDir2, f)).size / 1048576).toFixed(1);
            restored.push(`${f} (${sizeMB} MB)`);
          }

          // Start server
          spawn(SERVER_EXE, ['-log'], { cwd: CONAN_DIR, detached: true, stdio: 'ignore' }).unref();

          const embed = new EmbedBuilder()
            .setTitle('🔄 Server Wiped — Map Rooms Restored')
            .setColor(COLORS.green)
            .setDescription('The server has been wiped and the wipe template has been restored.\nAll map rooms and admin structures are back.')
            .addFields(
              { name: 'Restored Files', value: restored.join('\n') },
              { name: 'Pre-wipe Backup', value: preWipeDir },
              { name: 'Status', value: '🟢 Server restarting... allow 30-60 seconds.' },
            );
          return interaction.editReply({ embeds: [embed] });
        } catch (e) {
          // Try to restart server if something went wrong
          try { spawn(SERVER_EXE, ['-log'], { cwd: CONAN_DIR, detached: true, stdio: 'ignore' }).unref(); } catch {}
          return interaction.editReply(`❌ Wipe failed: ${e.message}\nAttempting server restart...`);
        }
      }

      case 'wipeinfo': {
        const wipeDir3 = 'D:\\backups\\conan\\wipe-state';
        try {
          const wipeFiles = fs.readdirSync(wipeDir3).filter(f => f.match(/^game.*\.db$/));
          if (wipeFiles.length === 0) {
            return interaction.reply({ content: '📋 No wipe state saved yet. An admin can use `/wipesave` to create one.', ephemeral: true });
          }
          let meta = {};
          try { meta = JSON.parse(fs.readFileSync(path.join(wipeDir3, 'wipe-state.json'), 'utf8')); } catch {}

          const fileList = wipeFiles.map(f => {
            const sizeMB = (fs.statSync(path.join(wipeDir3, f)).size / 1048576).toFixed(1);
            return `${f} (${sizeMB} MB)`;
          });

          const embed = new EmbedBuilder()
            .setTitle('📋 Wipe State Info')
            .setColor(COLORS.blue)
            .addFields(
              { name: 'Saved', value: meta.savedAt ? meta.savedAt.split('T')[0] : 'Unknown', inline: true },
              { name: 'By', value: meta.savedBy || 'Unknown', inline: true },
              { name: 'Files', value: fileList.join('\n') },
            )
            .setFooter({ text: 'This template preserves map rooms across wipes' });
          return interaction.reply({ embeds: [embed] });
        } catch {
          return interaction.reply({ content: '📋 No wipe state saved yet.', ephemeral: true });
        }
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
              `Damage Taken: **${cfg.PlayerDamageTakenMultiplier || 1}x**\n` +
              `NPC Damage: **${cfg.NPCDamageMultiplier || 1}x**\n` +
              `NPC Health: **${cfg.NPCHealthMultiplier || 1}x**`, inline: true },
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

      // ═══ Shop ═══
      case 'shop': {
        const shop = loadShop().filter(p => p.enabled);
        if (shop.length === 0) return interaction.reply({ content: 'No packages available.', ephemeral: true });
        const lines = shop.map(p => `${p.emoji || '📦'} **${p.name}** — ${p.description}\n\u2003\u2003ID: \`${p.id}\` • ${p.items.length} items${p.price ? ` • ${p.price} coins` : ' • Free'}`);
        const embed = new EmbedBuilder()
          .setTitle('🛒 GRUDGE EXILES — Shop')
          .setColor(COLORS.gold)
          .setDescription(lines.join('\n\n'))
          .setFooter({ text: 'Admins: /kit <player> <id> to grant • Manage at conan.grudge-studio.com' });
        return interaction.reply({ embeds: [embed] });
      }

      // ═══ Kits (dynamic from shop.json) ═══
      case 'kit': {
        const player = interaction.options.getString('player');
        const kitName = interaction.options.getString('kit');
        const items = getKit(kitName);
        if (!items) {
          const shop = loadShop().filter(p => p.enabled);
          const available = shop.map(p => `\`${p.id}\``).join(', ');
          return interaction.reply({ content: `❌ Unknown kit **${kitName}**. Available: ${available || 'none'}`, ephemeral: true });
        }
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
        const pkg = loadShop().find(p => p.id === kitName);
        const embed = new EmbedBuilder()
          .setTitle(`${pkg?.emoji || '🎁'} Kit: ${pkg?.name || kitName}`)
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
