# Removes VB-CABLE. Only called when VoicePlay installed it (see build/installer.nsh).
# Lives next to VB-CABLE's setup in %ProgramData%\VoicePlay\vbcable. Run elevated.

$ErrorActionPreference = "Stop"

$setup = Join-Path $PSScriptRoot "VBCABLE_Setup_x64.exe"
if (-not (Test-Path $setup)) {
    Write-Host "VB-CABLE setup not found at $setup; nothing to do."
    exit 0
}

# -u = uninstall, -h = hidden. TODO: confirm -u with VB-Audio; only -i -h is community-confirmed.
Start-Process -FilePath $setup -ArgumentList "-u", "-h" -Wait

# Clean up our copy of the pack. A reboot finishes the uninstall.
Set-Location $env:TEMP
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $env:ProgramData "VoicePlay")
exit 0
