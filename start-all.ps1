# GRUDGE EXILES — Full Stack Startup
# Run as Administrator for UPnP + firewall access

Write-Host "=== GRUDGE EXILES — Full Deploy ===" -ForegroundColor Red

# 1. UPnP Port Forwards
Write-Host "[1/5] UPnP port forwards..." -ForegroundColor Cyan
$upnp = [activator]::CreateInstance([type]::GetTypeFromProgID('HNetCfg.NATUPnP'))
$maps = $upnp.StaticPortMappingCollection
try { $maps.Add(7777,'UDP','7777','10.0.0.132',1,'Conan Game') } catch {}
try { $maps.Add(7778,'UDP','7778','10.0.0.132',1,'Conan Game Raw') } catch {}
try { $maps.Add(27015,'UDP','27015','10.0.0.132',1,'Conan Steam Query') } catch {}
Write-Host "  UDP 7777, 7778, 27015 -> 10.0.0.132" -ForegroundColor Green

# 2. Conan Server
Write-Host "[2/5] Starting Conan server..." -ForegroundColor Cyan
Start-Process "D:\ConanServer\ConanSandboxServer.exe" -ArgumentList "-log -Multihome=10.0.0.132 -MULTIHOMEHTTP=10.0.0.132 -Port=7777 -QueryPort=27015 -RCONEnabled=1 -RCONPort=25575 -RCONPassword=grudgercon2026" -WorkingDirectory "D:\ConanServer"
Write-Host "  Server launching with RCON enabled" -ForegroundColor Green

# 3. Admin Panel
Write-Host "[3/5] Starting admin panel..." -ForegroundColor Cyan
Start-Process node -ArgumentList "D:\conan-admin\server.js" -WorkingDirectory "D:\conan-admin" -WindowStyle Hidden
Write-Host "  Admin panel on port 3847" -ForegroundColor Green

# 4. Discord Bot
Write-Host "[4/5] Starting Discord bot..." -ForegroundColor Cyan
Start-Process node -ArgumentList "D:\conan-admin\bot.js" -WorkingDirectory "D:\conan-admin" -WindowStyle Hidden
Write-Host "  Grudge Bot starting..." -ForegroundColor Green

# 5. Cloudflare Tunnel
Write-Host "[5/5] Starting Cloudflare tunnel..." -ForegroundColor Cyan
Start-Process cloudflared -ArgumentList "tunnel","--config","C:\Users\david\.cloudflared\config-conan.yml","run" -WindowStyle Hidden
Write-Host "  Tunnel -> conan.grudge-studio.com" -ForegroundColor Green

Write-Host "`n=== ALL SERVICES LAUNCHED ===" -ForegroundColor Green
Write-Host "Server: 76.31.186.50:7777" -ForegroundColor Yellow
Write-Host "Admin:  https://conan.grudge-studio.com" -ForegroundColor Yellow
Write-Host "Allow 30-60s for Conan to fully boot" -ForegroundColor Gray
