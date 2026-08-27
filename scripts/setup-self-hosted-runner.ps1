#Requires -Version 5.1
<#
.SYNOPSIS
  Install and register a GitHub Actions self-hosted runner (Windows) for recombyn-dev CI.

.DESCRIPTION
  Private repos do not get unlimited GitHub-hosted minutes. A self-hosted runner on your
  Windows machine runs CI jobs without consuming Actions billing minutes.

  Prerequisites (install manually if missing):
    - Git for Windows
    - Node.js 22 LTS
    - Python 3.12
    - (optional) run as Administrator to install the runner Windows service

  Get a one-time registration token:
    GitHub → recombyn/recombyn-dev → Settings → Actions → Runners → New self-hosted runner
    Copy the token from the configure step (expires in ~1 hour).

.EXAMPLE
  .\scripts\setup-self-hosted-runner.ps1 -RegistrationToken "XXXXX"
#>
param(
  [Parameter(Mandatory = $true)]
  [string] $RegistrationToken,
  [string] $RunnerRoot = "$env:USERPROFILE\actions-runner-recombyn",
  [string] $RepoUrl = "https://github.com/recombyn/recombyn-dev",
  [string[]] $Labels = @("self-hosted", "Windows", "ci")
)

$ErrorActionPreference = "Stop"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Write-Host "== Checking toolchain =="
Require-Command git
Require-Command node
Require-Command npm
Require-Command python

$nodeMajor = (node -p "process.versions.node.split('.')[0]")
if ([int]$nodeMajor -lt 22) {
  Write-Warning "Node $nodeMajor detected; CI expects Node 22+. Install from https://nodejs.org/"
}

$pyVer = (python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
if ($pyVer -ne "3.12") {
  Write-Warning "Python $pyVer detected; CI expects 3.12. Install from https://www.python.org/downloads/"
}

Write-Host "== Preparing runner directory: $RunnerRoot =="
New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null
Set-Location $RunnerRoot

if (-not (Test-Path ".\config.cmd")) {
  Write-Host "== Downloading actions-runner-win-x64 =="
  $zip = Join-Path $env:TEMP "actions-runner-win-x64.zip"
  Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-win-x64-2.321.0.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $RunnerRoot -Force
  Remove-Item $zip -Force
}

Write-Host "== Configuring runner (labels: $($Labels -join ', ')) =="
$configArgs = @(
  "--url", $RepoUrl,
  "--token", $RegistrationToken,
  "--name", $env:COMPUTERNAME,
  "--unattended",
  "--replace"
) + ($Labels | ForEach-Object { "--labels"; $_ })

& .\config.cmd @configArgs

Write-Host ""
Write-Host "Runner configured. Start it with ONE of:"
Write-Host "  Interactive (terminal must stay open):  cd `"$RunnerRoot`"; .\run.cmd"
Write-Host "  Windows service (Admin PowerShell):     cd `"$RunnerRoot`"; .\svc.install; .\svc.start"
Write-Host ""
Write-Host "Verify: GitHub → recombyn-dev → Settings → Actions → Runners (status: Idle)"
