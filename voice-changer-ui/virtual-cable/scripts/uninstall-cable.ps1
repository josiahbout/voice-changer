# Removes the VoicePlay virtual cable driver. Needs an elevated (admin) prompt.
# SCAFFOLD: not usable until the driver is built (see ..\README.md).

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$HardwareId = "Root\VoicePlayCable"
$Devcon     = Join-Path $PSScriptRoot "..\driver\build\devcon.exe"   # TODO: ship devcon from the WDK

& $Devcon remove $HardwareId
if ($LASTEXITCODE -ne 0) { Write-Error "devcon remove failed ($LASTEXITCODE)." }

# TODO: also delete the staged driver package (pnputil /delete-driver oemNN.inf /uninstall),
# looking up oemNN.inf from `pnputil /enum-drivers`.

Write-Host "VoicePlay cable removed."
