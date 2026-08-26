# Local dev stack: Docker MySQL + Redis + MinIO, then npm services.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "==> Recombyn local setup (MySQL + MinIO)" -ForegroundColor Cyan

if (-not (Test-Command docker)) {
  Write-Host "Docker not found. Install Docker Desktop first:" -ForegroundColor Red
  Write-Host "  https://www.docker.com/products/docker-desktop/"
  exit 1
}

Write-Host "==> Starting mysql, redis, minio..."
docker compose up -d mysql redis minio minio-init
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Waiting for MySQL..."
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  docker compose exec -T mysql mysqladmin ping -h 127.0.0.1 -urecombyn -precombyn 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Host "MySQL not ready — check: docker compose logs mysql" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Infrastructure ready." -ForegroundColor Green
Write-Host "  MinIO console : http://127.0.0.1:9001  (minioadmin / minioadmin)"
Write-Host "  MySQL         : 127.0.0.1:3306         (recombyn / recombyn)"
Write-Host ""
Write-Host "Start app (separate terminals):"
Write-Host "  npm run dev:api"
Write-Host "  npm run dev:worker"
Write-Host "  npm run dev:web"
Write-Host ""
Write-Host "Health check after API starts:"
Write-Host "  curl http://127.0.0.1:8000/api/v1/health"
