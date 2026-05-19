const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const ini = require('ini');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ──
const CONAN_DIR = 'D:\\ConanServer';
const SETTINGS_PATH = path.join(CONAN_DIR, 'ConanSandbox', 'Saved', 'Config', 'WindowsServer', 'ServerSettings.ini');
const ENGINE_PATH = path.join(CONAN_DIR, 'ConanSandbox', 'Saved', 'Config', 'WindowsServer', 'Engine.ini');
const LOG_PATH = path.join(CONAN_DIR, 'ConanSandbox', 'Saved', 'Logs', 'ConanSandbox.log');
const SERVER_EXE = path.join(CONAN_DIR, 'ConanSandboxServer.exe');
const ADMIN_TOKEN = process.env.CONAN_ADMIN_TOKEN || 'admin123';
const PORT = process.env.PORT || 3847;

// ── Auth middleware ──
function auth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Settings schema (all vanilla, no-mod Conan Exiles settings) ──
const SETTINGS_SCHEMA = {
  server: {
    label: 'Server Identity',
    fields: {
      ServerName: { type: 'string', label: 'Server Name', default: 'My Conan Server' },
      ServerPassword: { type: 'string', label: 'Server Password (blank = open)', default: '' },
      AdminPassword: { type: 'string', label: 'Admin Password', default: '' },
      MaxPlayers: { type: 'int', label: 'Max Players', default: 40, min: 1, max: 70 },
      serverRegion: { type: 'int', label: 'Region (0=EU, 1=NA, 2=Asia, 3=SA, 4=AU)', default: 1, min: 0, max: 4 },
      IsBattlEyeEnabled: { type: 'bool', label: 'BattlEye Anti-Cheat', default: true },
      ServerCommunity: { type: 'int', label: 'Community (0=None, 1=Purist, 2=Relaxed, 3=Hardcore, 4=RP, 5=Experimental)', default: 2, min: 0, max: 5 },
    }
  },
  pvp: {
    label: 'PVP',
    fields: {
      PVPEnabled: { type: 'bool', label: 'PVP Enabled', default: true },
      PVPBlitzServer: { type: 'bool', label: 'Blitz Server (fast PVP)', default: false },
      PVPBuildingDamage: { type: 'bool', label: 'Building Damage in PVP', default: true },
    }
  },
  damage: {
    label: 'Damage Model',
    fields: {
      PlayerDamageMultiplier: { type: 'float', label: 'Player Damage Output', default: 1.0, min: 0, max: 10, step: 0.05 },
      PlayerDamageTakenMultiplier: { type: 'float', label: 'Player Damage Taken', default: 1.0, min: 0, max: 10, step: 0.05 },
      NPCDamageMultiplier: { type: 'float', label: 'NPC Damage Output', default: 1.0, min: 0, max: 10, step: 0.1 },
      NPCDamageTakenMultiplier: { type: 'float', label: 'NPC Damage Taken', default: 1.0, min: 0, max: 10, step: 0.1 },
      NPCHealthMultiplier: { type: 'float', label: 'NPC Health', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      NPCRespawnMultiplier: { type: 'float', label: 'NPC Respawn Speed', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      MinionDamageMultiplier: { type: 'float', label: 'Minion Damage Output', default: 1.0, min: 0, max: 10, step: 0.1 },
      MinionDamageTakenMultiplier: { type: 'float', label: 'Minion Damage Taken', default: 1.0, min: 0, max: 10, step: 0.1 },
      BuildingDamageMultiplier: { type: 'float', label: 'Building Damage', default: 1.0, min: 0, max: 10, step: 0.1 },
    }
  },
  pets: {
    label: 'Pets & Thralls',
    fields: {
      ThrallDamageToPlayersMultiplier: { type: 'float', label: 'Thrall Damage to Players', default: 1.0, min: 0, max: 10, step: 0.1 },
      ThrallDamageToNPCsMultiplier: { type: 'float', label: 'Thrall Damage to NPCs', default: 1.0, min: 0, max: 10, step: 0.1 },
      PetDamageMultiplier: { type: 'float', label: 'Pet Damage', default: 1.0, min: 0, max: 10, step: 0.1 },
      PetDamageTakenMultiplier: { type: 'float', label: 'Pet Damage Taken', default: 1.0, min: 0, max: 10, step: 0.1 },
      PetHealthMultiplier: { type: 'float', label: 'Pet Health', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      MaxFollowingThralls: { type: 'int', label: 'Max Following Thralls', default: 1, min: 0, max: 20 },
      MaxCoopThralls: { type: 'int', label: 'Max Co-op Thralls', default: 1, min: 0, max: 20 },
      ThrallCorruptionRemovalMultiplier: { type: 'float', label: 'Thrall Corruption Removal', default: 1.0, min: 0, max: 10, step: 0.1 },
    }
  },
  harvest: {
    label: 'Harvest & XP',
    fields: {
      HarvestAmountMultiplier: { type: 'float', label: 'Harvest Amount', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      ResourceRespawnSpeedMultiplier: { type: 'float', label: 'Resource Respawn Speed', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      PlayerXPRateMultiplier: { type: 'float', label: 'XP Rate', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      PlayerXPKillMultiplier: { type: 'float', label: 'XP from Kills', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      PlayerXPHarvestMultiplier: { type: 'float', label: 'XP from Harvesting', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      PlayerXPTimeMultiplier: { type: 'float', label: 'XP over Time', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      CraftingXPMultiplier: { type: 'float', label: 'XP from Crafting', default: 1.0, min: 0.1, max: 10, step: 0.1 },
    }
  },
  loot: {
    label: 'Loot & Items',
    fields: {
      DropEquipmentOnDeath: { type: 'bool', label: 'Drop Equipment on Death', default: true },
      EverybodyCanLootCorpse: { type: 'bool', label: 'Everyone Can Loot Corpses', default: true },
      ItemSpoilRateScale: { type: 'float', label: 'Item Spoil Rate', default: 1.0, min: 0, max: 10, step: 0.1 },
      DurabilityMultiplier: { type: 'float', label: 'Durability', default: 1.0, min: 0.1, max: 10, step: 0.1 },
    }
  },
  survival: {
    label: 'Stamina & Survival',
    fields: {
      PlayerStaminaCostMultiplier: { type: 'float', label: 'Stamina Cost', default: 1.0, min: 0.1, max: 5, step: 0.05 },
      PlayerSprintCostMultiplier: { type: 'float', label: 'Sprint Cost', default: 1.0, min: 0.1, max: 5, step: 0.05 },
      PlayerActiveThirstMultiplier: { type: 'float', label: 'Active Thirst Rate', default: 1.0, min: 0.1, max: 5, step: 0.1 },
      PlayerActiveHungerMultiplier: { type: 'float', label: 'Active Hunger Rate', default: 1.0, min: 0.1, max: 5, step: 0.1 },
      PlayerIdleThirstMultiplier: { type: 'float', label: 'Idle Thirst Rate', default: 1.0, min: 0, max: 5, step: 0.1 },
      PlayerIdleHungerMultiplier: { type: 'float', label: 'Idle Hunger Rate', default: 1.0, min: 0, max: 5, step: 0.1 },
      PlayerHealthMultiplier: { type: 'float', label: 'Player Health', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      PlayerStaminaMultiplier: { type: 'float', label: 'Player Stamina Pool', default: 1.0, min: 0.1, max: 10, step: 0.1 },
    }
  },
  daynight: {
    label: 'Day / Night Cycle',
    fields: {
      DayCycleSpeedScale: { type: 'float', label: 'Day Cycle Speed', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      DayTimeSpeedScale: { type: 'float', label: 'Daytime Speed', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      NightTimeSpeedScale: { type: 'float', label: 'Nighttime Speed', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      DawnDuskSpeedScale: { type: 'float', label: 'Dawn/Dusk Speed', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      UseClientCatchUpTime: { type: 'bool', label: 'Client Catch-up Time', default: false },
    }
  },
  building: {
    label: 'Building & Decay',
    fields: {
      BuildingDecayEnabled: { type: 'bool', label: 'Building Decay', default: true },
      DisableBuildingAbandonment: { type: 'bool', label: 'Disable Building Abandonment', default: false },
      BuildingPreloadRadius: { type: 'int', label: 'Building Preload Radius', default: 0, min: 0, max: 100 },
    }
  },
  crafting: {
    label: 'Crafting',
    fields: {
      CraftingTimeMultiplier: { type: 'float', label: 'Crafting Time', default: 1.0, min: 0.01, max: 10, step: 0.1 },
      ThrallCraftingTimeMultiplier: { type: 'float', label: 'Thrall Crafting Time', default: 1.0, min: 0.01, max: 10, step: 0.1 },
      FuelBurnTimeMultiplier: { type: 'float', label: 'Fuel Burn Time', default: 1.0, min: 0.1, max: 10, step: 0.1 },
    }
  },
  purge: {
    label: 'Purge',
    fields: {
      EnablePurge: { type: 'bool', label: 'Enable Purge', default: true },
      PurgeLevel: { type: 'int', label: 'Purge Level (1-6)', default: 6, min: 1, max: 6 },
      PurgePeriodicity: { type: 'int', label: 'Purge Periodicity (seconds)', default: 24000, min: 1000, max: 9999999 },
      PurgePreparationTime: { type: 'int', label: 'Preparation Time (min)', default: 10, min: 1, max: 60 },
      PurgeDuration: { type: 'int', label: 'Duration (min)', default: 30, min: 5, max: 120 },
      MinPurgeOnlinePlayers: { type: 'int', label: 'Min Online Players for Purge', default: 0, min: 0, max: 40 },
    }
  },
  chat: {
    label: 'Chat',
    fields: {
      ChatMaxMessageLength: { type: 'int', label: 'Max Message Length', default: 512, min: 32, max: 2048 },
      ChatFloodControlDelay: { type: 'float', label: 'Flood Control Delay (sec)', default: 1.0, min: 0, max: 30, step: 0.5 },
    }
  },
  rcon: {
    label: 'RCON',
    fields: {
      RCONEnabled: { type: 'bool', label: 'RCON Enabled', default: true },
      RCONPort: { type: 'int', label: 'RCON Port', default: 25575, min: 1024, max: 65535 },
      RCONPassword: { type: 'string', label: 'RCON Password', default: '' },
    }
  },
};

// ── Helpers ──
function isServerRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq ConanSandboxServer-Win64-Shipping.exe" /FO CSV /NH', { encoding: 'utf8' });
    return out.includes('ConanSandboxServer');
  } catch { return false; }
}

function getServerProcess() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-Process ConanSandboxServer-Win64-Shipping -ErrorAction SilentlyContinue | Select-Object Id,CPU,@{N=\'MemMB\';E={[math]::Round($_.WorkingSet64/1MB)}},StartTime | ConvertTo-Json"',
      { encoding: 'utf8' }
    );
    return JSON.parse(out);
  } catch { return null; }
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  const parsed = ini.parse(raw);
  return parsed.ServerSettings || parsed;
}

function writeSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Preserve comment header
  const content = '[ServerSettings]\n' + Object.entries(settings)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
  fs.writeFileSync(SETTINGS_PATH, content, 'utf8');
}

// ── API Routes ──

// Schema
app.get('/api/schema', (req, res) => {
  res.json(SETTINGS_SCHEMA);
});

// Server status
app.get('/api/status', auth, (req, res) => {
  const running = isServerRunning();
  const proc = running ? getServerProcess() : null;
  res.json({ running, process: proc, publicIp: '76.31.186.50', gamePort: 7777, queryPort: 27015 });
});

// Start server
app.post('/api/server/start', auth, (req, res) => {
  if (isServerRunning()) return res.json({ ok: false, message: 'Server is already running' });
  try {
    spawn(SERVER_EXE, ['-log'], { cwd: CONAN_DIR, detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true, message: 'Server starting...' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Stop server
app.post('/api/server/stop', auth, (req, res) => {
  if (!isServerRunning()) return res.json({ ok: false, message: 'Server is not running' });
  try {
    execSync('taskkill /IM ConanSandboxServer-Win64-Shipping.exe /F', { encoding: 'utf8' });
    execSync('taskkill /IM ConanSandboxServer.exe /F', { encoding: 'utf8' });
    res.json({ ok: true, message: 'Server stopped' });
  } catch (e) {
    res.json({ ok: true, message: 'Stop signal sent' });
  }
});

// Restart server
app.post('/api/server/restart', auth, async (req, res) => {
  try {
    if (isServerRunning()) {
      try { execSync('taskkill /IM ConanSandboxServer-Win64-Shipping.exe /F'); } catch {}
      try { execSync('taskkill /IM ConanSandboxServer.exe /F'); } catch {}
    }
    // Wait for process to fully exit
    await new Promise(r => setTimeout(r, 5000));
    spawn(SERVER_EXE, ['-log'], { cwd: CONAN_DIR, detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true, message: 'Server restarting...' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Get settings
app.get('/api/settings', auth, (req, res) => {
  try {
    const settings = readSettings();
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update settings
app.put('/api/settings', auth, (req, res) => {
  try {
    const current = readSettings();
    const updates = req.body;
    // Merge updates
    const merged = { ...current, ...updates };
    writeSettings(merged);
    res.json({ ok: true, message: 'Settings saved. Restart server to apply changes.' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Get logs (last N lines)
app.get('/api/logs', auth, (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  try {
    if (!fs.existsSync(LOG_PATH)) return res.json({ logs: 'No log file yet.' });
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    const allLines = content.split('\n');
    const tail = allLines.slice(-lines).join('\n');
    res.json({ logs: tail });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// RCON helper (custom impl for Conan's non-standard auth packets)
function rconPacket(id, type, body) {
  const size = 10 + Buffer.byteLength(body, 'utf8');
  const buf = Buffer.alloc(size + 4);
  buf.writeInt32LE(size, 0); buf.writeInt32LE(id, 4); buf.writeInt32LE(type, 8);
  buf.write(body, 12, 'utf8'); buf[size + 2] = 0; buf[size + 3] = 0;
  return buf;
}
function sendRcon(command) {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const settings = readSettings();
    const port = parseInt(settings.RCONPort) || 25575;
    const pw = settings.RCONPassword || '';
    let authDone = false, result = '';
    const c = net.connect(port, '10.0.0.132', () => c.write(rconPacket(1, 3, pw)));
    c.setTimeout(8000);
    c.on('data', d => {
      const body = d.toString('utf8', 12, d.length - 2);
      if (!authDone) {
        if (body.includes('Authentication failed')) { c.end(); return reject(new Error('RCON auth failed')); }
        authDone = true;
        c.write(rconPacket(2, 2, command));
      } else {
        result += body;
        setTimeout(() => { c.end(); resolve(result.trim()); }, 500);
      }
    });
    c.on('timeout', () => { c.end(); authDone ? resolve(result.trim()) : reject(new Error('RCON timeout')); });
    c.on('error', e => reject(e));
  });
}

// RCON command
app.post('/api/rcon', auth, async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'No command provided' });
  try {
    const response = await sendRcon(command);
    res.json({ ok: true, response });
  } catch (e) {
    res.json({ ok: false, response: `RCON error: ${e.message}` });
  }
});

// Server info (public, no auth needed — for conan.grudge-studio.com landing)
app.get('/api/serverinfo', (req, res) => {
  const running = isServerRunning();
  const proc = running ? getServerProcess() : null;
  const settings = readSettings();
  const { generateMOTD } = require('./motd');
  const motd = generateMOTD();
  res.json({
    name: settings.ServerName || 'GRUDGE EXILES',
    running,
    publicIp: '76.31.186.50',
    gamePort: 7777,
    queryPort: 27015,
    maxPlayers: parseInt(settings.MaxPlayers) || 40,
    process: proc,
    motd: motd.raw,
    motdTheme: motd.theme,
    balance: {
      playerDamage: settings.PlayerDamageMultiplier || '1',
      playerDamageTaken: settings.PlayerDamageTakenMultiplier || '1',
      petDamage: settings.PetDamageMultiplier || '1',
      petDamageTaken: settings.PetDamageTakenMultiplier || '1',
      harvest: settings.HarvestAmountMultiplier || '1',
      xpRate: settings.PlayerXPRateMultiplier || '1',
      craftCost: settings.CraftingCostMultiplier || '1',
      craftTime: settings.CraftingTimeMultiplier || '1',
      fullLoot: settings.DropEquipmentOnDeath === 'True',
      knockbackPlayer: settings.PlayerKnockbackMultiplier || '1',
      knockbackNPC: settings.NPCKnockbackMultiplier || '1',
      corruption: settings.PlayerCorruptionGainMultiplier || '1',
      stability: settings.StabilityLossMultiplier || '1',
    },
    adminPanel: 'https://conan.grudge-studio.com',
  });
});

// MOTD endpoint
app.get('/api/motd', (req, res) => {
  const { generateMOTD } = require('./motd');
  res.json(generateMOTD());
});

// ── Shop API (purchasable kits/packages) ──
const SHOP_PATH = path.join(__dirname, 'data', 'shop.json');
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

function readShop() {
  const dir = path.dirname(SHOP_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SHOP_PATH)) { fs.writeFileSync(SHOP_PATH, JSON.stringify(DEFAULT_SHOP, null, 2)); return DEFAULT_SHOP; }
  try { return JSON.parse(fs.readFileSync(SHOP_PATH, 'utf8')); } catch { return DEFAULT_SHOP; }
}
function writeShop(data) {
  const dir = path.dirname(SHOP_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SHOP_PATH, JSON.stringify(data, null, 2));
}

// Public: list enabled packages
app.get('/api/shop', (req, res) => {
  const shop = readShop();
  const isAdmin = (req.headers['x-admin-token'] || req.query.token) === ADMIN_TOKEN;
  res.json(isAdmin ? shop : shop.filter(p => p.enabled));
});

// Admin: create package
app.post('/api/shop', auth, (req, res) => {
  const shop = readShop();
  const pkg = req.body;
  if (!pkg.id || !pkg.name) return res.status(400).json({ ok: false, message: 'id and name required' });
  if (shop.find(p => p.id === pkg.id)) return res.status(409).json({ ok: false, message: `Package '${pkg.id}' already exists` });
  pkg.enabled = pkg.enabled !== false;
  pkg.items = pkg.items || [];
  pkg.createdAt = new Date().toISOString();
  shop.push(pkg);
  writeShop(shop);
  res.json({ ok: true, message: `Package '${pkg.id}' created`, package: pkg });
});

// Admin: update package
app.put('/api/shop/:id', auth, (req, res) => {
  const shop = readShop();
  const idx = shop.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, message: 'Package not found' });
  shop[idx] = { ...shop[idx], ...req.body, id: req.params.id };
  writeShop(shop);
  res.json({ ok: true, message: `Package '${req.params.id}' updated`, package: shop[idx] });
});

// Admin: delete package
app.delete('/api/shop/:id', auth, (req, res) => {
  let shop = readShop();
  const before = shop.length;
  shop = shop.filter(p => p.id !== req.params.id);
  if (shop.length === before) return res.status(404).json({ ok: false, message: 'Package not found' });
  writeShop(shop);
  res.json({ ok: true, message: `Package '${req.params.id}' deleted` });
});

// Admin: grant package to player via RCON
app.post('/api/shop/:id/grant', auth, async (req, res) => {
  const shop = readShop();
  const pkg = shop.find(p => p.id === req.params.id);
  if (!pkg) return res.status(404).json({ ok: false, message: 'Package not found' });
  const results = [];
  for (const item of pkg.items) {
    try {
      await sendRcon(`con SpawnItem ${item.id} ${item.qty}`);
      results.push({ name: item.name, qty: item.qty, ok: true });
    } catch (e) {
      results.push({ name: item.name, qty: item.qty, ok: false, error: e.message });
    }
  }
  res.json({ ok: true, package: pkg.name, results });
});

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Conan Admin Panel running on http://localhost:${PORT}`);
});
