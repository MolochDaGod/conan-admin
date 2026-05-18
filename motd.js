// GRUDGE EXILES — Daily Message of the Day System
// Rotates through themed messages, writes to ServerSettings.ini and broadcasts via RCON
// Run via setInterval in bot.js or as standalone cron

const fs = require('fs');
const path = require('path');
const net = require('net');

const SETTINGS_PATH = 'D:\\ConanServer\\ConanSandbox\\Saved\\Config\\WindowsServer\\ServerSettings.ini';
const MOTD_LOG = path.join(__dirname, 'data', 'motd-history.json');

// ── Message pools by theme ──
const THEMES = {
  combat: [
    "Swords tickle. Poison kills. Stack your bleeds or die trying.",
    "Your weapon is a delivery system for DoTs. Act accordingly.",
    "The warrior who lands 10 weak hits outlives the one who swings once and misses.",
    "Daggers + poison = the real endgame. Don't sleep on alchemists.",
    "Knockback is king today. Bring a hammer and own the cliffside fights.",
    "Every hit is a chance to bleed. Every bleed is a countdown to death.",
    "Smart fighters poison their blade BEFORE the fight. Be smart.",
  ],
  pets: [
    "Your pet does 2x damage and takes half. If you're fighting without one, you're losing.",
    "Revive your downed pets mid-fight — 30 seconds out of combat is all it takes.",
    "A Greater Wolf with bleed stacks will outperform most players. Respect the meta.",
    "Feed boxes reach 3x further now. Your pets eat well on GRUDGE EXILES.",
    "Taming is nearly 3x faster here. Go grab that Greater Bear before someone else does.",
    "Your followers go DOWN, not dead. Rescue them and they'll fight again.",
  ],
  building: [
    "Stability loss is halved — build that impossible treehouse you've always wanted.",
    "Bases harden over time. The longer you hold ground, the tougher your walls get.",
    "Craft from storage within 80m. Your entire base is one big workbench.",
    "Half-cost materials mean you can experiment. Build weird. Build dangerous.",
    "Offline protection kicks in 20 minutes after logout. Plan your raids accordingly.",
  ],
  survival: [
    "3x harvest, 3x XP, half craft cost. You'll be raiding by sundown.",
    "Corruption builds slowly here. Sorcery is a marathon, not a sprint.",
    "Stamina regens fast but exhaustion punishes hard. Manage it or die gasping.",
    "Thralls convert in a third of the time. That named fighter is worth the kidnapping.",
    "Full loot PVP. Every piece of gear you carry is a gift to your killer.",
    "Sprint 15% faster than vanilla. Outrun what you can't outfight.",
  ],
  lore: [
    "The Exiled Lands remember those who bleed. Leave your mark in poison and fire.",
    "In GRUDGE EXILES, the strong don't just survive — they apply pressure over time.",
    "Racalvin whispers from the void: 'The blade is not the weapon. The venom is.'",
    "The old gods favor those who understand: death is not instant, it is gradual.",
    "On this server, patience is deadlier than strength. Let the DoTs do their work.",
    "Every exile who walks these lands carries poison. The question is: whose?",
  ],
  tips: [
    "Tip: Use /status in Discord to check server health anytime.",
    "Tip: Link your Steam ID with /link in Discord for teleport commands.",
    "Tip: /warps shows 6 fast-travel points across the map. Use them.",
    "Tip: Admin panel at conan.grudge-studio.com — check live settings and logs.",
    "Tip: Mounts tire 2x faster in PvP. Dismount fights are where DoTs shine.",
    "Tip: Concussion damage is boosted 1.7x. Thrall hunting is FAST here.",
  ],
};

// ── Generate today's MOTD ──
function generateMOTD() {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const themeKeys = Object.keys(THEMES);
  
  // Pick theme based on day of week
  const themeIndex = now.getDay() % themeKeys.length;
  const theme = themeKeys[themeIndex];
  const messages = THEMES[theme];
  
  // Pick message based on day of year (cycles through the pool)
  const msgIndex = dayOfYear % messages.length;
  const message = messages[msgIndex];
  
  const prefix = `[Day ${dayOfYear}] `;
  const suffix = ` | conan.grudge-studio.com`;
  
  return { theme, message: prefix + message + suffix, raw: message, date: now.toISOString().split('T')[0] };
}

// ── Write MOTD to ServerSettings.ini ──
function writeMOTDToConfig(motdText) {
  if (!fs.existsSync(SETTINGS_PATH)) return false;
  let ini = fs.readFileSync(SETTINGS_PATH, 'utf8');
  ini = ini.replace(/ServerMessageOfTheDay=.*/, `ServerMessageOfTheDay=${motdText}`);
  fs.writeFileSync(SETTINGS_PATH, ini, 'utf8');
  return true;
}

// ── Broadcast via RCON ──
function rconBroadcast(message) {
  return new Promise((resolve, reject) => {
    function rconPacket(id, type, body) {
      const size = 10 + Buffer.byteLength(body, 'utf8');
      const buf = Buffer.alloc(size + 4);
      buf.writeInt32LE(size, 0); buf.writeInt32LE(id, 4); buf.writeInt32LE(type, 8);
      buf.write(body, 12, 'utf8'); buf[size + 2] = 0; buf[size + 3] = 0;
      return buf;
    }
    let authDone = false, result = '';
    const c = net.connect(25575, '10.0.0.132', () => c.write(rconPacket(1, 3, 'grudgercon2026')));
    c.setTimeout(8000);
    c.on('data', d => {
      const body = d.toString('utf8', 12, d.length - 2);
      if (!authDone) {
        if (body.includes('Authentication failed')) { c.end(); return reject(new Error('RCON auth failed')); }
        authDone = true;
        c.write(rconPacket(2, 2, `broadcast ${message}`));
      } else {
        result += body;
        setTimeout(() => { c.end(); resolve(result.trim()); }, 500);
      }
    });
    c.on('timeout', () => { c.end(); resolve(result || 'timeout'); });
    c.on('error', e => reject(e));
  });
}

// ── Log history ──
function logMOTD(entry) {
  const dir = path.dirname(MOTD_LOG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let history = [];
  try { history = JSON.parse(fs.readFileSync(MOTD_LOG, 'utf8')); } catch {}
  history.push(entry);
  if (history.length > 90) history = history.slice(-90); // keep 90 days
  fs.writeFileSync(MOTD_LOG, JSON.stringify(history, null, 2));
}

// ── Main: update MOTD ──
async function updateMOTD() {
  const motd = generateMOTD();
  console.log(`[MOTD] ${motd.date} [${motd.theme}]: ${motd.raw}`);
  
  // Write to config
  writeMOTDToConfig(motd.message);
  
  // Broadcast to server
  try {
    await rconBroadcast(`=== MESSAGE OF THE DAY === ${motd.raw}`);
    console.log('[MOTD] Broadcasted to server');
  } catch (e) {
    console.log('[MOTD] Broadcast failed (server may be down):', e.message);
  }
  
  // Log
  logMOTD(motd);
  return motd;
}

// ── Export for use in bot.js ──
module.exports = { updateMOTD, generateMOTD, THEMES };

// ── Run standalone ──
if (require.main === module) {
  updateMOTD().then(m => console.log('Done:', m.message));
}
