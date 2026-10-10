# Builds the portable VoicePlay folder for alpha testers and zips it.
#
#   npm run package               (or: powershell -File build/package.ps1)
#   npm run package -- -NoZip     (folder only, for testing)
#
# Result: dist\VoicePlay\ (run VoicePlay.exe) and dist\VoicePlay-<version>-alpha.zip.
# Layout inside dist\VoicePlay\resources:
#   app.asar   the Electron app (built by electron-builder)
#   vbcable    the VB-CABLE driver pack (see electron/vbcable.js)
#   server     the voice server's code, base models (pretrain) and voices (model_dir)
#   python     Python 3.10 with the server's packages (copied from server\.venv and its base Python)
# See electron/server.js for how the app finds and runs these.
param([switch]$NoZip)

$ErrorActionPreference = "Stop"
$ui = Split-Path -Parent $PSScriptRoot
$serverSrc = Join-Path (Split-Path -Parent $ui) "server"
$venv = Join-Path $serverSrc ".venv"
$dist = Join-Path $ui "dist"
$out = Join-Path $dist "VoicePlay"
$resources = Join-Path $out "resources"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

# Copies a folder with robocopy (fast, and handles the 4 GB of torch well). Robocopy exit
# codes below 8 mean success.
function Copy-Tree($from, $to, [string[]]$excludeDirs = @(), [string[]]$excludeFiles = @()) {
  $rcArgs = @($from, $to, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/MT:16")
  if ($excludeDirs) { $rcArgs += "/XD"; $rcArgs += $excludeDirs }
  if ($excludeFiles) { $rcArgs += "/XF"; $rcArgs += $excludeFiles }
  & robocopy @rcArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying $from (exit code $LASTEXITCODE)" }
}

# ---------- Checks ----------
$pyvenvCfg = Join-Path $venv "pyvenv.cfg"
if (-not (Test-Path $pyvenvCfg)) { throw "No Python environment at $venv. Set up the server first (see server/README)." }
$pythonHome = ((Get-Content $pyvenvCfg | Where-Object { $_ -match "^home\s*=" }) -replace "^home\s*=\s*", "").Trim()
if (-not (Test-Path (Join-Path $pythonHome "python.exe"))) { throw "The venv's base Python isn't at $pythonHome." }
foreach ($dir in "pretrain", "model_dir") {
  if (-not (Test-Path (Join-Path $serverSrc $dir))) { throw "server\$dir is missing; run the server once so it downloads the base models." }
}

# ---------- Electron app ----------
Step "Building the Electron app"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
Push-Location $ui
try {
  & npx.cmd electron-builder --win dir
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
} finally { Pop-Location }
Move-Item (Join-Path $dist "win-unpacked") $out

# ---------- Voice server ----------
Step "Copying the voice server, base models and voices"
# Leave out the dev environment, caches and anything the server writes while running.
Copy-Tree $serverSrc (Join-Path $resources "server") `
  -excludeDirs @(".venv", "__pycache__", "tmp_dir", "upload_dir", "logs", "keys", "model_dir_static", ".pytest_cache") `
  -excludeFiles @("stored_setting.json", "*.log", "*.bat", "*.pyc")

# ---------- Python ----------
Step "Copying Python $pythonHome"
$python = Join-Path $resources "python"
# The base install without its own packages, docs or Tk, then the server's packages on top.
Copy-Tree $pythonHome $python -excludeDirs @((Join-Path $pythonHome "Lib\site-packages"), (Join-Path $pythonHome "Doc"), (Join-Path $pythonHome "tcl"), (Join-Path $pythonHome "Tools"), "__pycache__")
Step "Copying the server's Python packages"
Copy-Tree (Join-Path $venv "Lib\site-packages") (Join-Path $python "Lib\site-packages") -excludeDirs @("__pycache__")

# Quick check that the copied Python runs on its own and finds torch with CUDA.
Step "Checking the bundled Python"
$env:PYTHONNOUSERSITE = "1"
& (Join-Path $python "python.exe") -c "import sys, torch, onnxruntime; print(sys.prefix); print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) { throw "The bundled Python couldn't import the server's packages." }

$size = (Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1GB
Write-Host ("`nFolder ready: {0} ({1:N1} GB)" -f $out, $size) -ForegroundColor Green

# ---------- Zip ----------
if ($NoZip) { return }
$version = (Get-Content (Join-Path $ui "package.json") -Raw | ConvertFrom-Json).version
$zip = Join-Path $dist "VoicePlay-$version-alpha.zip"
Step "Zipping to $zip (takes a while)"
if (Test-Path $zip) { Remove-Item -Force $zip }
# Windows' own tar (bsdtar) writes zip64, so files over 4 GB and archives over 4 GB are fine;
# Compress-Archive isn't reliable at this size.
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $dist "VoicePlay"
if ($LASTEXITCODE -ne 0) { throw "zipping failed" }
Write-Host ("Zip ready: {0} ({1:N1} GB)" -f $zip, ((Get-Item $zip).Length / 1GB)) -ForegroundColor Green
