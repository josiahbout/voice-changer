# Installs the VoicePlay virtual cable driver. Needs an elevated (admin) prompt.
# SCAFFOLD: not usable until the driver is built and signed (see ..\README.md).

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

# Must match the hardware ID in the driver's .inf after rebranding.
$HardwareId = "Root\VoicePlayCable"
$Inf        = Join-Path $PSScriptRoot "..\driver\build\VoicePlayCable.inf"   # TODO: real build output path
$Devcon     = Join-Path $PSScriptRoot "..\driver\build\devcon.exe"           # TODO: ship devcon from the WDK

if (-not (Test-Path $Inf)) {
    Write-Error "Driver not built yet: $Inf not found. See ..\README.md."
}

& (Join-Path $PSScriptRoot "check-cable.ps1") | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "VoicePlay cable is already installed."
    exit 0
}

# A virtual driver has no hardware to detect, so the device node has to be created
# ("root-enumerated"). devcon does that and installs the driver in one step.
& $Devcon install $Inf $HardwareId
if ($LASTEXITCODE -ne 0) { Write-Error "devcon install failed ($LASTEXITCODE)." }

Write-Host "VoicePlay cable installed."
