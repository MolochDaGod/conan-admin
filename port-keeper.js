// Port Keeper — keeps UPnP port forwards alive on Xfinity gateways
// Runs as a background service, re-adding forwards every 60 seconds
// Also provides an API for the admin panel to manage port rules

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const RULES_FILE = path.join(__dirname, 'data', 'port-rules.json');

// Default rules
const DEFAULT_RULES = [
  { ext: 7777, int: 7777, proto: 'UDP', ip: '10.0.0.132', name: 'Conan Game' },
  { ext: 7778, int: 7778, proto: 'UDP', ip: '10.0.0.132', name: 'Conan Game Raw' },
  { ext: 27015, int: 27015, proto: 'UDP', ip: '10.0.0.132', name: 'Conan Steam Query' },
];

function loadRules() {
  try { return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')); }
  catch { return DEFAULT_RULES; }
}

function saveRules(rules) {
  const dir = path.dirname(RULES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
}

function applyRules(rules) {
  try {
    // PowerShell script to add UPnP mappings
    const ps = rules.map(r =>
      `try { $maps.Add(${r.ext},'${r.proto}','${r.int}','${r.ip}',1,'${r.name}') } catch {}`
    ).join('; ');

    const cmd = `powershell -NoProfile -Command "$upnp = [activator]::CreateInstance([type]::GetTypeFromProgID('HNetCfg.NATUPnP')); $maps = $upnp.StaticPortMappingCollection; ${ps}; $maps.Count"`;
    const result = execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
    return { ok: true, count: parseInt(result) || rules.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function checkPorts(rules) {
  try {
    const ports = rules.map(r => r.ext).join('|');
    const out = execSync(`netstat -ano | findstr "${ports}"`, { encoding: 'utf8', timeout: 5000 });
    const listening = rules.map(r => ({
      ...r,
      listening: out.includes(`:${r.ext}`)
    }));
    return listening;
  } catch { return rules.map(r => ({ ...r, listening: false })); }
}

// ── Main loop ──
let intervalMs = 60000; // refresh every 60s
let lastApply = null;

function tick() {
  const rules = loadRules();
  const result = applyRules(rules);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  if (result.ok) {
    console.log(`[${now}] Port forwards applied: ${rules.length} rules`);
  } else {
    console.error(`[${now}] FAILED: ${result.error}`);
  }
  lastApply = { time: now, result, rules };
}

// Initial apply
console.log('Port Keeper started — refreshing UPnP every 60s');
if (!fs.existsSync(RULES_FILE)) saveRules(DEFAULT_RULES);
tick();
setInterval(tick, intervalMs);

// ── Express API for admin panel integration ──
const express = require('express');
const app = express();
app.use(express.json());

app.get('/api/ports', (req, res) => {
  const rules = loadRules();
  const status = checkPorts(rules);
  res.json({ rules: status, lastApply });
});

app.post('/api/ports', (req, res) => {
  const { ext, int: intPort, proto, ip, name } = req.body;
  if (!ext || !intPort || !proto || !ip || !name) return res.status(400).json({ error: 'Missing fields' });
  const rules = loadRules();
  // Don't add duplicates
  if (rules.some(r => r.ext === ext && r.proto === proto)) {
    return res.json({ ok: false, message: 'Rule already exists' });
  }
  rules.push({ ext, int: intPort, proto, ip, name });
  saveRules(rules);
  const result = applyRules(rules);
  res.json({ ok: true, message: `Added ${name} (${proto} ${ext} -> ${ip}:${intPort})`, result });
});

app.delete('/api/ports/:ext/:proto', (req, res) => {
  const ext = parseInt(req.params.ext);
  const proto = req.params.proto.toUpperCase();
  let rules = loadRules();
  const before = rules.length;
  rules = rules.filter(r => !(r.ext === ext && r.proto === proto));
  if (rules.length === before) return res.json({ ok: false, message: 'Rule not found' });
  saveRules(rules);
  // Remove from router
  try {
    execSync(`powershell -NoProfile -Command "$upnp = [activator]::CreateInstance([type]::GetTypeFromProgID('HNetCfg.NATUPnP')); $upnp.StaticPortMappingCollection.Remove(${ext},'${proto}')"`, { timeout: 10000 });
  } catch {}
  res.json({ ok: true, message: `Removed ${proto} ${ext}` });
});

app.post('/api/ports/refresh', (req, res) => {
  tick();
  res.json({ ok: true, lastApply });
});

const PORT = 3848;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Port Keeper API on http://127.0.0.1:${PORT}`);
});
