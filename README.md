# ⚔ GRUDGE EXILES — Server & Admin Panel

Conan Exiles dedicated server with a web-based admin panel, hosted locally and exposed via Cloudflare Tunnel.

## Architecture

```
Internet
  │
  ├─ conan.grudge-studio.com ──▶ Cloudflare Tunnel ──▶ localhost:3847 (Admin Panel)
  │
  └─ 76.31.186.50:7777 ──▶ Router Port Forward ──▶ 10.0.0.56:7777 (Conan Server)
```

- **Server Machine**: Home PC (10.0.0.56, public IP 76.31.186.50)
- **Conan Server**: Funcom Dedicated Server Launcher (`C:\Users\david\Downloads\DedicatedServerLauncher\ConanExilesDedicatedServer`)
- **Admin Panel**: `D:\conan-admin` (Node.js + Express, port 3847)
- **Tunnel**: Cloudflare tunnel → `conan.grudge-studio.com`
- **Discord Webhook**: Posts heartbeat + MOTD to Grudge Studio Discord

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
| Admin Panel | Token: `admin123` |
| In-game Admin | Password: `grudgestudio2026` |
| RCON | Password: `admin123` (Game.ini) |

## Connecting

- **Direct Connect**: `76.31.186.50:7777`
- **Steam Browser**: View → Game Servers → search "GRUDGE EXILES"
- **Admin Panel**: https://conan.grudge-studio.com

## Custom Balance — "Grudges Enhanced PVP"

### Combat
| Setting | Value | Effect |
|-------------------------------|-------|--------------------------------------|
| PlayerHealthMultiplier | 5.0 | **1000 HP** base (200 × 5) |
| PlayerDamageMultiplier | 1.0 | Standard player damage |
| PlayerDamageTakenMultiplier | 0.6 | **40% damage reduction** for players |
| NPCDamageMultiplier | 2.0 | NPCs hit twice as hard |
| NPCDamageTakenMultiplier | 0.6 | **40% DR** for mobs |
| MinionDamageTakenMultiplier | 0.6 | **40% DR** for minions |
| PetDamageTakenMultiplier | 0.6 | **40% DR** for pets |
| ThrallDamageToPlayersMultiplier | 2.0 | Thralls hit players at 2x |
| ThrallDamageToNPCsMultiplier | 2.0 | Thralls hit NPCs at 2x |
| FriendlyFireDamageMultiplier | 0.1 | 10% friendly fire |

### Economy
| Setting | Value | Effect |
|-------------------------------|-------|--------------------------------------|
| HarvestAmountMultiplier | 2.5 | 2.5x resource gathering |
| PlayerXPRateMultiplier | 3.0 | 3x XP across all sources |
| CraftingCostMultiplier | 0.5 | Half crafting material cost |
| ItemConvertionMultiplier | 0.5 | 2x crafting speed |
| ThrallConversionMultiplier | 0.5 | 2x thrall break speed |
| ResourceRespawnSpeedMultiplier | 2.0 | 2x resource respawn |
| BuildingDamageMultiplier | 2.5 | Raids hit hard |
| EverybodyCanLootCorpse | True | Full loot PVP |
| clanMaxSize | 12 | Max 12 per clan |
| PlayerCorruptionGainMultiplier | 0.5 | Half corruption gain |

Everyone has 1000 HP and 40% DR across the board. NPCs hit 2x, thralls are war-ready at 2x both ways, raids matter at 2.5x building damage. All settings editable via admin panel (restart to apply).

## Admin Panel Features

- **Server Controls**: Start / Stop / Restart
- **Live Status**: Process memory, CPU time, PID, uptime (polls every 10s)
- **Settings Editor**: 13 categories covering all vanilla (no-mod) server settings
- **RCON Console**: Send commands directly to the server
- **Log Viewer**: Tail the latest 200 lines of server logs
- **Auth**: Token-based — enter the admin token to access

### Server-Side / Admin-Only Edits

Anything that mutates server state requires either the admin panel token or a Discord user with the `Administrator` permission. All of these are *server-side-only*: there is no in-game UI for them.

| Surface | Capability | Where |
|--------------------------|------------------------------------------------------|----------------------------|
| Settings editor (web) | Edit any of the 13 categories in `ServerSettings.ini` | `PUT /api/settings` |
| Server lifecycle (web) | Start / Stop / Restart the dedicated server process | `POST /api/server/*` |
| RCON console (web) | Send any RCON command (broadcast, teleport, ban, etc.) | `POST /api/rcon` |
| Log tail (web) | Read the last N lines of `ConanSandbox.log` | `GET /api/logs?lines=N` |
| Server lifecycle (bot) | `/start` `/stop` `/restart` with broadcast warnings | `bot.js` admin commands |
| Player moderation (bot) | `/kick` `/ban` `/unban` | RCON-backed |
| World admin (bot) | `/broadcast` `/rcon` `/tp` `/tpto` `/kit` | RCON-backed |
| Warp management (bot) | `/setwarp` `/delwarp` — persists to `data/warps.json` | local JSON |
| Spawn point (bot) | `/setspawn` — persists to `data/spawns.json` | local JSON |
| MOTD (bot) | `/refreshmotd` — re-runs the daily MOTD job now | `motd.js` |

Player-facing slash commands (`/home`, `/warp`, `/spawn`) only *call* `con TeleportPlayer` via RCON against the admin console character — the player still has to be the in-game admin or be teleported by an admin. The bot does not (and cannot, without a server-side mod) teleport an arbitrary player by Steam ID through vanilla RCON.

### API Endpoints

| Method | Path | Auth | Description |
|--------|----------------------|------|------------------------------|
| GET | `/api/schema` | No | Settings schema/metadata |
| GET | `/api/serverinfo` | No | Public landing-page info (status, balance, MOTD) |
| GET | `/api/motd` | No | Today's MOTD payload |
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
C:\Users\david\Downloads\DedicatedServerLauncher\ConanExilesDedicatedServer\
├── ConanSandboxServer.exe              # Server launcher
└── ConanSandbox\Saved\
    ├── Config\WindowsServer\
    │   ├── ServerSettings.ini          # All gameplay settings
    │   ├── Engine.ini                  # Ports, network, server name
    │   └── Game.ini                    # RCON config ([RconPlugin])
    ├── Logs\ConanSandbox.log           # Server log
    └── game*.db                        # World database

D:\conan-admin\                         # Admin panel + Discord bot
├── server.js                           # Express backend (web admin)
├── bot.js                              # Discord bot (35 slash commands)
├── public\index.html                   # Frontend UI
├── data\                               # Bot persistent storage
│   ├── homes.json                      # Player home locations
│   ├── warps.json                      # Warp points
│   ├── spawns.json                     # Custom spawn point
│   ├── players.json                    # Discord↔character links (auto-link)
│   ├── online-players.json             # Cached online player list (60s poll)
│   └── shop.json                       # Shop/kit packages
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

The bot (`bot.js`) runs as **Grudge Bot#0024** with 35 slash commands. It registers globally by default, or per-guild (instantly) when `DISCORD_GUILD_ID` is set in `.env`.

### Auto-Link System
Players link their Discord to their in-game character by typing `/link <character name>` while online. The bot polls `listplayers` via RCON every 60s, caches online players, and matches by character name (case-insensitive, partial match supported). No raw Steam IDs needed.

### Player Commands
| Command | Description |
|---------|-------------|
| `/status` | Server status, uptime, player count |
| `/players` | List online players |
| `/serverinfo` | Connection details and balance overview |
| `/rules` | Server rules |
| `/settings` | Current balance multipliers |
| `/motd` | Show today's message of the day |
| `/sethome <name> <x> <y> <z>` | Save a location (max 5) |
| `/home <name>` | Teleport to saved home |
| `/homes` | List your homes |
| `/delhome <name>` | Delete a home |
| `/warp <name>` | Teleport to a warp point |
| `/warps` | List all warp points |
| `/spawn` | Teleport to server spawn |
| `/link <character>` | Link Discord to in-game character (must be online) |
| `/unlink` | Unlink character |
| `/whoami` | Show linked character info + online status |

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
| `/refreshmotd` | Force-refresh today's MOTD now |
| `/kit <player> <kit>` | Give starter/builder/warrior/alchemist kit |

### Default Warps
- `noob-river` — Starting area on the southern river
- `sepermeru` — City of Relic Hunters
- `mounds` — Mounds of the Dead
- `volcano` — The Volcano region
- `jungle` — Eastern jungle
- `unnamed-city` — The Unnamed City ruins

### Discord Webhook Posts

The bot writes two kinds of automated posts to the channel webhook set in `DISCORD_CONAN_WEBHOOK`. They post as the `GRUDGE EXILES` username and require no slash-command interaction.

| Post | Source | Cadence | Contents |
|----------------|------------------------|--------------------|-----------------------------------------------------|
| Heartbeat | `bot.js` `heartbeat()` | every 5 min + boot | 🟢/🔴 status, connect string, memory, uptime |
| MOTD | `motd.js` `postToWebhook()` | daily at 00:00 + `/refreshmotd` | Themed message of the day, theme, date, connect |

The MOTD job additionally rewrites `ServerMessageOfTheDay=` in `ServerSettings.ini` and broadcasts the line in-game via RCON, so all three surfaces (in-game, Discord, web landing page at `/api/motd`) stay in sync.

### Emoji-click warp (not yet implemented)

There is currently **no** reaction-based or button-based warp flow in the bot — all warp UX goes through the `/warp <name>` slash command. The bot only listens for `interactionCreate` of type `ChatInputCommand`; no `messageReactionAdd`, `Button`, or `StringSelectMenu` handlers are registered, and the `GuildMessageReactions` gateway intent is not enabled. If you want a "click 🌀 on the warp post to teleport" flow, it needs to be designed and added — see the *Open follow-ups* note at the bottom of this file.

### Environment Variables

The bot and admin panel read the following from `.env` (see `.env.example` if present):

| Variable | Used by | Purpose |
|----------------------------|------------------------|---------------------------------------------------------|
| `DISCORD_TOKEN` | `bot.js` | Bot login token |
| `DISCORD_CLIENT_ID` | `bot.js` | Application ID for slash-command registration |
| `DISCORD_GUILD_ID` | `bot.js` | Optional — instant per-guild registration for dev |
| `DISCORD_CONAN_WEBHOOK` | `bot.js`, `motd.js` | Webhook URL for heartbeat and MOTD posts |
| `RCON_HOST` | `bot.js` | RCON host (`10.0.0.56` — server's MULTIHOME IP) |
| `RCON_PORT` | `bot.js` | RCON port (default `25575`) |
| `RCON_PASSWORD` | `bot.js` | RCON password — must match Game.ini `[RconPlugin]` |
| `CONAN_ADMIN_TOKEN` | `server.js` | Admin panel bearer token (default `admin123`) |
| `CONAN_DIR` | `bot.js` | Conan install dir (launcher path) |
| `PORT` | `server.js` | Admin panel port (default `3847`) |

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

# 2. Conan server (launched by Funcom Dedicated Server Launcher, or manually):
# The launcher at C:\Users\david\Downloads\DedicatedServerLauncher handles startup.
# Manual fallback:
Start-Process "C:\Users\david\Downloads\DedicatedServerLauncher\ConanExilesDedicatedServer\ConanSandboxServer.exe" -ArgumentList "/Game/Maps/ConanSandbox/ConanSandbox -MULTIHOME=10.0.0.56 -MaxPlayers=40 -log" -WorkingDirectory "C:\Users\david\Downloads\DedicatedServerLauncher\ConanExilesDedicatedServer"

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

## Open Follow-ups

- **Emoji-click warp from Discord post.** Proposed flow: bot posts (or replaces) a "Warp Map" embed in a designated channel with one reaction per warp (🌀 + per-region emoji). When a linked user reacts, the bot looks up `players.json[uid].steamId`, the warp coords, and runs `con TeleportPlayer …` via RCON. Requires: enable `GuildMessageReactions` intent, add `messageReactionAdd` handler, store the warp-message ID, and decide whether to also expose a button-based row (`ActionRowBuilder` is already imported but unused). Not implemented yet — confirm the UX before code lands.
- **Per-player teleport via RCON.** Vanilla RCON `TeleportPlayer` only targets the admin console character. True per-player teleport needs either a server-side mod or an in-game admin running the command. The current `/warp`, `/home`, `/spawn` flows are honest about this in their reply text.
- **Webhook channel routing.** Today a single `DISCORD_CONAN_WEBHOOK` receives both heartbeat and MOTD posts. Splitting into `DISCORD_CONAN_HEARTBEAT_WEBHOOK` and `DISCORD_CONAN_MOTD_WEBHOOK` would let admins keep status spam out of player-facing channels.

---

*Created by Racalvin The Pirate King — Grudge Studio*
