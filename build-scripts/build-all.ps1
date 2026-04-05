$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."

$version = (Get-Content -Path "Version" -Raw).Trim()
$date    = Get-Date -Format yyyyMMdd

Write-Host "=== VRCX-0 Build ===" -ForegroundColor Cyan

# ── 1. Frontend ──────────────────────────────────────────────
Write-Host "Building frontend..." -ForegroundColor Green
Remove-Item -Path "build\html" -Force -Recurse -ErrorAction SilentlyContinue
npm ci --loglevel=error
npm run prod
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

# ── 2. .NET ──────────────────────────────────────────────────
Write-Host "Building .NET..." -ForegroundColor Green
dotnet build Dotnet\VRCX-0.csproj `
    -p:Configuration=Release `
    -p:Platform=x64 `
    -t:Restore`,Build `
    -m --self-contained
if ($LASTEXITCODE -ne 0) { throw ".NET build failed" }

# ── 3. Zip ───────────────────────────────────────────────────
$zipName = "VRCX-0_${date}.zip"
Write-Host "Creating $zipName ..." -ForegroundColor Green
Push-Location build
if (Test-Path $zipName) { Remove-Item $zipName }
7z a -tzip $zipName * -mx=7 -xr0!"*.log" -xr0!"*.pdb" | Out-Null
Move-Item $zipName "..\..\$zipName" -Force
Pop-Location

# ── 4. Installer ─────────────────────────────────────────────
$setupName = "VRCX-0_${date}_Setup.exe"
Write-Host "Creating installer..." -ForegroundColor Green
Push-Location Installer
Out-File -FilePath "version_define.nsh" -Encoding UTF8 `
    -InputObject "!define PRODUCT_VERSION_FROM_FILE `"${version}.0`""
$nsis = "C:\Program Files (x86)\NSIS\makensis.exe"
& $nsis installer.nsi
if ($LASTEXITCODE -ne 0) { throw "NSIS failed" }
Start-Sleep -Seconds 1
Move-Item VRCX-0_Setup.exe "..\$setupName" -Force
Pop-Location

# ── 5. SHA256 ────────────────────────────────────────────────
$hash = (Get-FileHash -Path $setupName -Algorithm SHA256).Hash
"$hash  $setupName" | Out-File -FilePath "SHA256SUMS.txt" -Encoding ASCII

Write-Host "Done! → $zipName / $setupName" -ForegroundColor Green