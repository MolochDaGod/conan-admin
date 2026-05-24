// GRUDGE EXILES — In-Game Chat Log Watcher
// Tails ConanSandbox.log for chat commands and bridges to Discord/RCON
//
// Supported in-game chat commands:
//   !sethome <name> <x> <y> <z>   — Save a home location
//   !home <name>                    — Teleport to saved home (admin must execute)
//   !homes                          — List your saved homes
//   !warp <name>                    — Teleport to a warp point
//   !warps                          — List available warps
//
// Players get coords from: in-game admin panel → TeleportPlayer line,
// or by pressing Ctrl+Shift+Alt+L in-game to toggle coordinate display.
//
// Usage: require('./logwatcher')(rconFn, discordClient)

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const LOG_PATH = (process.env.CONAN_DIR || 'D:\\ConanServer') + '\\ConanSandbox\\Saved\\Logs\\ConanSandbox.log';
const DATA_DIR = path.join(__dirname, 'data');
const HOMES_FILE = path.join(DATA_DIR, 'homes.json');
const WARPS_FILE = path.join(DATA_DIR, 'warps.json');
const CHAT_CHANNEL = '1394826401311625306'; // same channel as heartbeat

function load(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// ── Chat line parser ──
// Conan Exiles Enhanced log format:
//   ChatWindow: Character Racalvin Pirate King (uid 109, player 76561198113644718) said: !warp home
//   ChatWindow: PlayerName: message
const CHAT_REGEX_ENHANCED = /ChatWindow:\s*Character\s+(.+?)\s*\(uid\s+\d+,\s*player\s+\d+\)\s+said:\s*(.+)/i;
const CHAT_REGEX_LEGACY = /ChatWindow:\s*(.+?):\s+(.+)/i;

function parseChatLine(line) {
  // Try Enhanced format first (has uid/player info)
  let m = line.match(CHAT_REGEX_ENHANCED);
  if (m) return { player: m[1].trim(), message: m[2].trim() };
  // Fallback to legacy format
  m = line.match(CHAT_REGEX_LEGACY);
  if (m) {
    const player = m[1].trim();
    const message = m[2].trim();
    if (player.includes('Character')) return null; // avoid partial matches
    return { player, message };
  }
  return null;
}

// ── Command handlers ──
function handleChatCommand(player, message, rconFn, discordClient) {
  const parts = message.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '!sethome': {
      // !sethome <name> — auto-reads position from game DB
      if (parts.length < 2) {
        broadcast(rconFn, `[GRUDGE] ${player}: Usage: !sethome <name>`);
        return;
      }
      const name = parts[1].toLowerCase();
      let x, y, z;
      try {
        const dbPath = (process.env.CONAN_DIR || 'D:\\ConanServer') + '\\ConanSandbox\\Saved\\game_0.db';
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const row = db.prepare('SELECT ap.x, ap.y, ap.z FROM characters c JOIN actor_position ap ON c.id = ap.id WHERE LOWER(c.char_name) = LOWER(?)').get(player);
        db.close();
        if (!row) { broadcast(rconFn, `[GRUDGE] ${player}: Could not find your position.`); return; }
        x = Math.round(row.x); y = Math.round(row.y); z = Math.round(row.z);
      } catch (e) {
        broadcast(rconFn, `[GRUDGE] ${player}: Error reading position.`);
        return;
      }
      const homes = load(HOMES_FILE);
      // Use player name as key (since we don't have Discord ID from in-game)
      const key = `ingame:${player.toLowerCase()}`;
      if (!homes[key]) homes[key] = {};
      if (Object.keys(homes[key]).length >= 5) {
        broadcast(rconFn, `[GRUDGE] ${player}: Max 5 homes. Delete one first with !delhome <name>`);
        return;
      }
      homes[key][name] = { x, y, z, set: Date.now(), setBy: player };
      save(HOMES_FILE, homes);
      broadcast(rconFn, `[GRUDGE] Home '${name}' saved at ${x}, ${y}, ${z}`);
      break;
    }

    case '!home': {
      // !home <name>
      if (parts.length < 2) {
        broadcast(rconFn, `[GRUDGE] ${player}: Usage: !home <name>`);
        return;
      }
      const name = parts[1].toLowerCase();
      const homes = load(HOMES_FILE);
      const key = `ingame:${player.toLowerCase()}`;
      if (!homes[key]?.[name]) {
        broadcast(rconFn, `[GRUDGE] ${player}: No home '${name}'. Use !homes to list.`);
        return;
      }
      const h = homes[key][name];
      // Look up player's userId from online cache for targeted teleport
      const onlineCache = load(path.join(DATA_DIR, 'online-players.json'));
      const onlineP = (onlineCache.players || []).find(p => p.charName.toLowerCase() === player.toLowerCase());
      const teleId = onlineP ? onlineP.userId : player;
      rconFn(`con ${teleId} TeleportPlayer ${h.x} ${h.y} ${h.z}`).catch(() => {});
      broadcast(rconFn, `[GRUDGE] Teleporting ${player} to home '${name}'`);
      break;
    }

    case '!delhome': {
      if (parts.length < 2) return;
      const name = parts[1].toLowerCase();
      const homes = load(HOMES_FILE);
      const key = `ingame:${player.toLowerCase()}`;
      if (homes[key]?.[name]) {
        delete homes[key][name];
        save(HOMES_FILE, homes);
        broadcast(rconFn, `[GRUDGE] Home '${name}' deleted.`);
      } else {
        broadcast(rconFn, `[GRUDGE] ${player}: No home '${name}'.`);
      }
      break;
    }

    case '!homes': {
      const homes = load(HOMES_FILE);
      const key = `ingame:${player.toLowerCase()}`;
      const userHomes = homes[key] || {};
      const names = Object.keys(userHomes);
      if (names.length === 0) {
        broadcast(rconFn, `[GRUDGE] ${player}: No homes saved. Use !sethome <name> <x> <y> <z>`);
      } else {
        broadcast(rconFn, `[GRUDGE] ${player}'s homes: ${names.join(', ')}`);
      }
      break;
    }

    case '!warp': {
      if (parts.length < 2) {
        broadcast(rconFn, `[GRUDGE] Usage: !warp <name>. Type !warps to see available.`);
        return;
      }
      const name = parts[1].toLowerCase();
      const warps = load(WARPS_FILE);
      if (!warps[name]) {
        broadcast(rconFn, `[GRUDGE] No warp '${name}'. Type !warps to see available.`);
        return;
      }
      const w = warps[name];
      // Look up player's userId for targeted teleport
      const onlineCache2 = load(path.join(DATA_DIR, 'online-players.json'));
      const onlineP2 = (onlineCache2.players || []).find(p => p.charName.toLowerCase() === player.toLowerCase());
      const teleId2 = onlineP2 ? onlineP2.userId : player;
      rconFn(`con ${teleId2} TeleportPlayer ${w.x} ${w.y} ${w.z}`).catch(() => {});
      broadcast(rconFn, `[GRUDGE] Warping ${player} to '${name}'`);
      break;
    }

    case '!warps': {
      const warps = load(WARPS_FILE);
      const names = Object.keys(warps);
      if (names.length === 0) {
        broadcast(rconFn, `[GRUDGE] No warps defined.`);
      } else {
        broadcast(rconFn, `[GRUDGE] Warps: ${names.join(', ')}`);
      }
      break;
    }

    default:
      // Not a command — it's regular chat, bridge to Discord
      if (!message.startsWith('!')) {
        postChatToDiscord(discordClient, `💬 **${player}**: ${message}`);
      }
      break;
  }
}

function broadcast(rconFn, msg) {
  rconFn(`broadcast ${msg}`).catch(e => console.log('[LogWatcher] Broadcast failed:', e.message));
}

async function postChatToDiscord(discordClient, content) {
  if (!discordClient) return;
  // Use webhook for avatar branding if available
  const webhookUrl = process.env.DISCORD_CONAN_WEBHOOK;
  if (webhookUrl) {
    const https = require('https');
    const m = webhookUrl.match(/\/webhooks\/(\d+)\/([\w-]+)/);
    if (m) {
      const payload = JSON.stringify({
        username: 'GRUDGE EXILES',
        avatar_url: 'https://conan.grudge-studio.com/img/hero.jpg',
        content,
      });
      const opts = { hostname: 'discord.com', path: `/api/webhooks/${m[1]}/${m[2]}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
      const req = https.request(opts); req.write(payload); req.end();
      return;
    }
  }
  try {
    const channel = await discordClient.channels.fetch(CHAT_CHANNEL);
    if (channel) await channel.send(content);
  } catch {}
}

// ── Log tail watcher ──
function startWatcher(rconFn, discordClient) {
  if (!fs.existsSync(LOG_PATH)) {
    console.log('[LogWatcher] Log file not found:', LOG_PATH);
    console.log('[LogWatcher] Will retry in 30s...');
    setTimeout(() => startWatcher(rconFn, discordClient), 30000);
    return;
  }

  let fileSize = fs.statSync(LOG_PATH).size; // Start from end of file (don't replay history)
  console.log(`[LogWatcher] Watching ${LOG_PATH} (starting at byte ${fileSize})`);

  // Poll every 2 seconds for new log lines
  const interval = setInterval(() => {
    try {
      const stat = fs.statSync(LOG_PATH);
      if (stat.size < fileSize) {
        // Log was rotated/truncated — reset to beginning
        fileSize = 0;
        console.log('[LogWatcher] Log file rotated, resetting position');
      }
      if (stat.size === fileSize) return; // No new data

      // Read only new bytes
      const fd = fs.openSync(LOG_PATH, 'r');
      const buf = Buffer.alloc(stat.size - fileSize);
      fs.readSync(fd, buf, 0, buf.length, fileSize);
      fs.closeSync(fd);
      fileSize = stat.size;

      // Process new lines
      const newText = buf.toString('utf8');
      const lines = newText.split('\n');
      for (const line of lines) {
        const chat = parseChatLine(line);
        if (chat) {
          console.log(`[LogWatcher] Chat: ${chat.player}: ${chat.message}`);
          handleChatCommand(chat.player, chat.message, rconFn, discordClient);
        }
      }
    } catch (e) {
      // File might be temporarily locked by the game server
      if (e.code !== 'EBUSY') console.log('[LogWatcher] Error:', e.message);
    }
  }, 2000);

  return interval;
}

module.exports = { startWatcher, parseChatLine };
