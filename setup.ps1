# pxndas - Full Deployment Script
# Run this in PowerShell as Administrator

Write-Host "=== pxndas Setup ===" -ForegroundColor Cyan

# 1. Install Node.js if missing
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[1/4] Installing Node.js..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    refreshenv
} else {
    Write-Host "[1/4] Node.js already installed ($(node -v))" -ForegroundColor Green
}

# 2. Install Git if missing
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[2/4] Installing Git..." -ForegroundColor Yellow
    winget install Git.Git --silent --accept-package-agreements
} else {
    Write-Host "[2/4] Git already installed ($(git --version))" -ForegroundColor Green
}

# 3. Install npm dependencies + Railway CLI
Write-Host "[3/4] Installing npm packages + Railway CLI..." -ForegroundColor Yellow
Set-Location -LiteralPath "C:\Users\braed\Downloads\ee"
npm install
npm install -g @railway/cli

# 4. Git init
Write-Host "[4/4] Initializing Git repo..." -ForegroundColor Yellow
git init
git add .
git commit -m "initial"

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "=== Deploy NOW ===" -ForegroundColor White
Write-Host ""
Write-Host "Step 1 - Login to Railway:" -ForegroundColor Yellow
Write-Host "  railway login" -ForegroundColor Gray
Write-Host "  (opens browser - sign in with GitHub)" -ForegroundColor Gray
Write-Host ""
Write-Host "Step 2 - Create & deploy:" -ForegroundColor Yellow
Write-Host "  railway init --name pxndas" -ForegroundColor Gray
Write-Host "  railway up" -ForegroundColor Gray
Write-Host ""
Write-Host "Step 3 - Get your URL:" -ForegroundColor Yellow
Write-Host "  railway domain" -ForegroundColor Gray
Write-Host "  (gives you free pxndas.up.railway.app)" -ForegroundColor Gray
Write-Host ""
Write-Host "Your site is LIVE at that URL ^" -ForegroundColor Green
Write-Host ""
Write-Host "Optional - Custom domain:" -ForegroundColor White
Write-Host "  Buy domain (~$10/yr at Cloudflare/Namecheap)" -ForegroundColor Gray
Write-Host "  railway domain --domain yourdomain.com" -ForegroundColor Gray
