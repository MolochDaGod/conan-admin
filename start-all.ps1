# GRUDGE EXILES — Full Stack Startup with Bot Watchdog
# Run as Administrator for UPnP + firewall access

$CONAN_EXE = "C:\Users\david\Downloads\DedicatedServerLauncher\ConanExilesDedicatedServer\ConanSandboxServer.exe"
$CONAN_DIR = "C:\Users\david\Downloads\DedicatedServerLauncher\ConanExilesDedicatedServer"
$ADMIN_DIR = "D:\conan-admin"

Write-Host "=== GRUDGE EXILES — Full Deploy ===" -ForegroundColor Red

# 1. UPnP Port Forwards
Write-Host "[1/5] UPnP port forwards..." -ForegroundColor Cyan
try {
  $upnp = [activator]::CreateInstance([type]::GetTypeFromProgID('HNetCfg.NATUPnP'))
  $maps = $upnp.StaticPortMappingCollection
  try { $maps.Add(7777,'UDP','7777','10.0.0.56',1,'Conan Game') } catch {}
  try { $maps.Add(7778,'UDP','7778','10.0.0.56',1,'Conan Game Raw') } catch {}
  try { $maps.Add(27015,'UDP','27015','10.0.0.56',1,'Conan Steam Query') } catch {}
  Write-Host "  UDP 7777, 7778, 27015 -> 10.0.0.56" -ForegroundColor Green
} catch { Write-Host "  UPnP unavailable (run as admin or set static port forwards)" -ForegroundColor Yellow }

# 2. Conan Server (Funcom Dedicated Server Launcher path)
Write-Host "[2/5] Starting Conan server..." -ForegroundColor Cyan
Start-Process $CONAN_EXE -ArgumentList "/Game/Maps/ConanSandbox/ConanSandbox -MULTIHOME=10.0.0.56 -MaxPlayers=40 -log" -WorkingDirectory $CONAN_DIR
Write-Host "  Server launching (RCON via Game.ini)" -ForegroundColor Green

# 3. Admin Panel
Write-Host "[3/5] Starting admin panel..." -ForegroundColor Cyan
Start-Process node -ArgumentList "$ADMIN_DIR\server.js" -WorkingDirectory $ADMIN_DIR -WindowStyle Hidden
Write-Host "  Admin panel on port 3847" -ForegroundColor Green

# 4. Discord Bot (with watchdog)
Write-Host "[4/5] Starting Discord bot with watchdog..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File $ADMIN_DIR\bot-watchdog.ps1" -WindowStyle Hidden
Write-Host "  Grudge Bot + watchdog starting..." -ForegroundColor Green

# 5. Cloudflare Tunnel
Write-Host "[5/5] Starting Cloudflare tunnel..." -ForegroundColor Cyan
Start-Process cloudflared -ArgumentList "tunnel","--config","C:\Users\david\.cloudflared\config-conan.yml","run" -WindowStyle Hidden
Write-Host "  Tunnel -> conan.grudge-studio.com" -ForegroundColor Green

Write-Host "`n=== ALL SERVICES LAUNCHED ===" -ForegroundColor Green
Write-Host "Server: 76.31.186.50:7777 (LAN: 10.0.0.56)" -ForegroundColor Yellow
Write-Host "Admin:  https://conan.grudge-studio.com" -ForegroundColor Yellow
Write-Host "Allow 30-60s for Conan to fully boot" -ForegroundColor Gray
