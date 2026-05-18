# ⚔ GRUDGE EXILES — Server & Admin Panel

Conan Exiles dedicated server with a web-based admin panel, hosted locally and exposed via Cloudflare Tunnel.

## Architecture

```
Internet
  │
  ├─ conan.grudge-studio.com ──▶ Cloudflare Tunnel ──▶ localhost:3847 (Admin Panel)
  │
  └─ 76.31.186.50:7777 ──▶ UPnP/Port Forward ──▶ 10.0.0.132:7777 (Conan Server)
```

- **Machine**: GRUDGEYONKO (Windows, RTX 3070 Ti, 32 GB RAM)
- **Conan Server**: `D:\ConanServer` (SteamCMD app 443030)
- **Admin Panel**: `D:\conan-admin` (Node.js + Express, port 3847)
- **Tunnel**: Cloudflare tunnel `conan-admin` → `conan.grudge-studio.com`

## Ports

| Port | Proto | Purpose |
|-------|-------|------------------------------|
| 7777 | UDP | Game traffic |
| 7778 | UDP | Game raw UDP |
| 27015 | UDP | Steam server query/browser |
| 25575 | TCP | RCON (localhost only) |
| 3847 | TCP | Admin panel (tunneled) |

## Credentials

| Service | Credential |
|-----------------|-------------------------------|
| Admin Panel | Token: `grudge-conan-2026` |
| In-game Admin | Password: `grudgeadmin2026` |
| RCON | Password: `grudgercon2026` |

## Connecting

- **Direct Connect**: `76.31.186.50:7777`
- **Steam Browser**: View → Game Servers → search "GRUDGE EXILES"
- **Admin Panel**: https://conan.grudge-studio.com

## Custom Balance — "DoTs Kill, Swords Don't"

| Setting | Value | Effect |
|-------------------------------|-------|--------------------------------------|
| PlayerDamageMultiplier | 0.25 | Weapons deal 1/4 damage |
| PetDamageMultiplier | 2.0 | Pets hit 2x harder |
| PetDamageTakenMultiplier | 0.5 | Pets take half damage |
| PetHealthMultiplier | 1.5 | Pets have 50% more HP |
| HarvestAmountMultiplier | 3.0 | 3x resource gathering |
| PlayerXPRateMultiplier | 3.0 | 3x XP across all sources |
| DropEquipmentOnDeath | True | Full loot PVP |
| EverybodyCanLootCorpse | True | Anyone can loot your body |

Bleed and poison tick for fixed damage regardless of the weapon multiplier, so reducing direct damage to 0.25x makes DoTs proportionally ~4x more impactful.

All settings are editable live via the admin panel (restart required to apply).

## Admin Panel Features

- **Server Controls**: Start / Stop / Restart
- **Live Status**: Process memory, CPU time, PID, uptime (polls every 10s)
- **Settings Editor**: 13 categories covering all vanilla (no-mod) server settings
- **RCON Console**: Send commands directly to the server
- **Log Viewer**: Tail the latest 200 lines of server logs
- **Auth**: Token-based — enter the admin token to access

### API Endpoints

| Method | Path | Auth | Description |
|--------|----------------------|------|------------------------------|
| GET | `/api/schema` | No | Settings schema/metadata |
| GET | `/api/status` | Yes | Server running state + process info |
| POST | `/api/server/start` | Yes | Start the Conan server |
| POST | `/api/server/stop` | Yes | Kill the Conan server |
| POST | `/api/server/restart` | Yes | Stop then start |
| GET | `/api/settings` | Yes | Read ServerSettings.ini |
| PUT | `/api/settings` | Yes | Write settings (restart to apply) |
| GET | `/api/logs?lines=N` | Yes | Tail N lines from server log |
| POST | `/api/rcon` | Yes | Send RCON command |

Auth: pass `x-admin-token` header or `?token=` query param.

## File Layout

```
D:\ConanServer\                         # Game server (SteamCMD)
├── ConanSandboxServer.exe              # Server launcher
└── ConanSandbox\Saved\
    ├── Config\WindowsServer\
    │   ├── ServerSettings.ini          # All gameplay settings
    │   └── Engine.ini                  # Ports, network, tick rate
    ├── Logs\ConanSandbox.log           # Server log
    └── game*.db                        # World database

D:\conan-admin\                         # Admin panel + Discord bot
├── server.js                           # Express backend (web admin)
├── bot.js                              # Discord bot (28 slash commands)
├── public\index.html                   # Frontend UI
├── data\                               # Bot persistent storage
│   ├── homes.json                      # Player home locations
│   ├── warps.json                      # Warp points
│   ├── spawns.json                     # Custom spawn point
│   └── players.json                    # Discord↔Steam ID links
├── backup.ps1                          # Backup script
├── .env                                # Discord + RCON credentials
├── .env.example                        # Template
├── package.json
└── README.md                           # This file

C:\Users\david\.cloudflared\
├── config-conan.yml                    # Tunnel config
└── 2a20e3d9-...json                    # Tunnel credentials
```

## Discord Bot

The bot (`bot.js`) runs as **Grudge Bot#0024** with 28 slash commands.

### Player Commands
| Command | Description |
|---------|-------------|
| `/status` | Server status, uptime, player count |
| `/players` | List online players |
| `/serverinfo` | Connection details and balance overview |
| `/rules` | Server rules |
| `/settings` | Current balance multipliers |
| `/sethome <name> <x> <y> <z>` | Save a location (max 5) |
| `/home <name>` | Teleport to saved home |
| `/homes` | List your homes |
| `/delhome <name>` | Delete a home |
| `/warp <name>` | Teleport to a warp point |
| `/warps` | List all warp points |
| `/spawn` | Teleport to server spawn |
| `/link <steamid>` | Link Discord to Steam ID |
| `/unlink` | Unlink Steam ID |

### Admin Commands
| Command | Description |
|---------|-------------|
| `/start` | Start the Conan server |
| `/stop` | Stop with 10s warning broadcast |
| `/restart` | Restart with 15s warning |
| `/broadcast <msg>` | Server-wide message |
| `/rcon <cmd>` | Raw RCON command |
| `/kick <player>` | Kick player |
| `/ban <player>` | Ban player |
| `/unban <player>` | Unban player |
| `/tp <player> <x> <y> <z>` | Teleport player |
| `/tpto <player>` | Teleport to player |
| `/setspawn <x> <y> <z>` | Set custom spawn point |
| `/setwarp <name> <x> <y> <z>` | Create warp point |
| `/delwarp <name>` | Delete warp point |
| `/kit <player> <kit>` | Give starter/builder/warrior/alchemist kit |

### Default Warps
- `noob-river` — Starting area on the southern river
- `sepermeru` — City of Relic Hunters
- `mounds` — Mounds of the Dead
- `volcano` — The Volcano region
- `jungle` — Eastern jungle
- `unnamed-city` — The Unnamed City ruins

### RCON Note
Conan Exiles uses a non-standard RCON auth packet (ID `537919488` instead of `1`). The bot and admin panel use a custom raw TCP RCON client to handle this — the `rcon-client` npm package does not work with Conan.

## Starting Everything (after reboot)

Run in an elevated PowerShell:

```powershell
# 1. UPnP port forwards (routers clear these on reboot)
$upnp = [activator]::CreateInstance([type]::GetTypeFromProgID('HNetCfg.NATUPnP'))
$maps = $upnp.StaticPortMappingCollection
$maps.Add(7777,'UDP','7777','10.0.0.132',1,'Conan Game')
$maps.Add(7778,'UDP','7778','10.0.0.132',1,'Conan Game Raw')
$maps.Add(27015,'UDP','27015','10.0.0.132',1,'Conan Steam Query')

# 2. Conan server (RCON flags required — ini alone won't enable it)
Start-Process "D:\ConanServer\ConanSandboxServer.exe" -ArgumentList "-log -RCONEnabled=1 -RCONPort=25575 -RCONPassword=grudgercon2026" -WorkingDirectory "D:\ConanServer"

# 3. Admin panel
Start-Process node -ArgumentList "D:\conan-admin\server.js" -WorkingDirectory "D:\conan-admin" -WindowStyle Hidden

# 4. Discord bot
Start-Process node -ArgumentList "D:\conan-admin\bot.js" -WorkingDirectory "D:\conan-admin" -WindowStyle Hidden

# 5. Cloudflare tunnel
Start-Process cloudflared -ArgumentList "tunnel","--config","C:\Users\david\.cloudflared\config-conan.yml","run" -WindowStyle Hidden
```

## Backups

Run manually or schedule via Task Scheduler:

```powershell
powershell -ExecutionPolicy Bypass -File D:\conan-admin\backup.ps1
```

- Backs up: game database, configs, admin panel source, tunnel config, recent logs
- Archives to `D:\backups\conan\YYYY-MM-DD_HH-mm.zip`
- Auto-prunes backups older than 7 days (configurable with `-KeepDays`)

## Updating the Server

```powershell
# Stop server first (via admin panel or manually)
taskkill /IM ConanSandboxServer-Win64-Shipping.exe /F
taskkill /IM ConanSandboxServer.exe /F

# Update via SteamCMD
D:\SteamCMD\steamcmd.exe +force_install_dir D:\ConanServer +login anonymous +app_update 443030 validate +quit

# Restart
Start-Process "D:\ConanServer\ConanSandboxServer.exe" -ArgumentList "-log" -WorkingDirectory "D:\ConanServer"
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Server not in Steam browser | Re-add UPnP forwards; check router didn't clear them |
| Admin panel 502/unreachable | Restart Node process and cloudflared tunnel |
| Settings not applying | Restart the Conan server after saving settings |
| High memory usage | Normal — Conan server uses 4-8 GB RAM |
| Port conflicts | Check with `netstat -ano \| findstr "7777 25575 27015"` |
| RCON auth failed | Ensure server was started with `-RCONPassword=grudgercon2026` flag |
| RCON timeout | Conan RCON is slow; the custom client has 8s timeout |
| Bot commands not showing | Global commands take up to 1hr; add `DISCORD_GUILD_ID` to `.env` for instant guild commands |
| Bot not responding | Check `bot-stdout.log` / `bot-stderr.log` for errors |

## Tech Stack

- **Game Server**: Conan Exiles Dedicated Server (SteamCMD app 443030)
- **Admin Panel**: Node.js + Express, served via Cloudflare Tunnel
- **Discord Bot**: discord.js v14, custom RCON client
- **DNS/Tunnel**: Cloudflare (grudge-studio.com)
- **Port Forwarding**: UPnP via Windows COM API
- **No mods** — all features use vanilla admin commands and server settings

---

*Created by Racalvin The Pirate King — Grudge Studio*
