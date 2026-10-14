$ErrorActionPreference = 'Stop'

# Jobpilot quick start for Windows PowerShell.
# Usage: irm https://raw.githubusercontent.com/sinariazi/jobpilot/main/scripts/quickstart.ps1 | iex

$repoArchive = 'https://github.com/sinariazi/jobpilot/archive/refs/heads/main.zip'
$chatModel = if ($env:JOBPILOT_CHAT_MODEL) { $env:JOBPILOT_CHAT_MODEL } else { 'qwen3.5:4b' }
$decisionModel = if ($env:JOBPILOT_DECISION_MODEL) { $env:JOBPILOT_DECISION_MODEL } else { 'tev1:0.8b' }

function Write-Step([string]$Message) {
  Write-Host "`n[Jobpilot] $Message" -ForegroundColor Cyan
}

function Test-NodeSupported {
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) { return $false }
  $version = (& node -p "process.versions.node" 2>$null)
  if ($LASTEXITCODE -ne 0) { return $false }
  try { return ([version]$version -ge [version]'22.13.0') } catch { return $false }
}

if ((Test-Path (Join-Path (Get-Location) 'package.json')) -and (Test-Path (Join-Path (Get-Location) 'src\app\page.tsx'))) {
  $projectDir = (Get-Location).Path
} else {
  $projectDir = if ($env:JOBPILOT_DIR) { $env:JOBPILOT_DIR } else { Join-Path $HOME 'Jobpilot' }
  if ((Test-Path (Join-Path $projectDir 'package.json')) -and (Test-Path (Join-Path $projectDir 'src\app\page.tsx'))) {
    Write-Step "Using existing project at $projectDir"
  } elseif (Test-Path $projectDir) {
    throw "$projectDir already exists but does not look like a Jobpilot folder. Move it or set JOBPILOT_DIR to another folder."
  } else {
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    try {
      Write-Step 'Downloading Jobpilot'
      $archivePath = Join-Path $tempDir 'jobpilot.zip'
      Invoke-WebRequest -Uri $repoArchive -OutFile $archivePath
      Expand-Archive -Path $archivePath -DestinationPath $tempDir
      $extracted = Get-ChildItem -Path $tempDir -Directory | Where-Object { $_.Name -like 'jobpilot-*' } | Select-Object -First 1
      if (-not $extracted) { throw 'The Jobpilot download did not contain the expected project folder.' }
      New-Item -ItemType Directory -Path $projectDir | Out-Null
      Copy-Item -Path (Join-Path $extracted.FullName '*') -Destination $projectDir -Recurse -Force
    } finally {
      Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not (Test-NodeSupported)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22.13 or newer is required. Install it from https://nodejs.org/, reopen PowerShell, and run the quick-start command again.'
  }
  $answer = Read-Host 'Node.js 22.13+ is missing. Install Node.js LTS with winget now? (Y/N)'
  if ($answer -notmatch '^[Yy]') { throw 'Install Node.js 22.13 or newer from https://nodejs.org/, then rerun this command.' }
  winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + (Join-Path $env:ProgramFiles 'nodejs')
  if (-not (Test-NodeSupported)) { throw 'Node.js was installed. Close and reopen PowerShell, then rerun the quick-start command.' }
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  $answer = Read-Host 'Ollama is required for local AI. Install it with the official installer now? (Y/N)'
  if ($answer -notmatch '^[Yy]') { throw 'Install Ollama from https://ollama.com/download, then rerun this command.' }
  irm https://ollama.com/install.ps1 | iex
  $ollamaPath = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $ollamaPath) { $env:Path += ";$(Split-Path $ollamaPath)" }
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { throw 'Ollama installed. Close and reopen PowerShell, then rerun this command.' }
}

try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null } catch {
  Write-Step 'Starting Ollama'
  Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; $ready = $true; break } catch {}
  }
  if (-not $ready) { throw 'Ollama did not start. Open the Ollama app, wait for it to start, and rerun this command.' }
}

function Test-OllamaModel([string]$Model) {
  $models = & ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] }
  return $models -contains $Model
}

Write-Step 'Checking local models. The suggested models need several gigabytes of free disk space on first download.'
if (-not (Test-OllamaModel $chatModel)) {
  Write-Step "Downloading chat model: $chatModel"
  & ollama pull $chatModel
  if ($LASTEXITCODE -ne 0) { throw "Could not download $chatModel. Check Ollama and available disk space, then rerun this command." }
}
if (-not (Test-OllamaModel $decisionModel)) {
  Write-Step "Downloading decision model: $decisionModel"
  & ollama pull $decisionModel
  if ($LASTEXITCODE -ne 0) { throw "Could not download $decisionModel. Check Ollama and available disk space, then rerun this command." }
}

Set-Location $projectDir
if (-not (Test-Path '.env.local') -and (Test-Path '.env.example')) { Copy-Item '.env.example' '.env.local' }
Write-Step 'Installing the exact project dependencies from package-lock.json'
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check the error above, then rerun this command.' }
Write-Step 'Starting Jobpilot. Keep this window open, then visit http://localhost:3000'
npm run dev
