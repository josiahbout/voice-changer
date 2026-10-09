# Installs the bundled VB-CABLE driver pack. Run elevated (the VoicePlay installer does this).
#
# Exit codes (read by build/installer.nsh):
#   0  = VB-CABLE setup ran; a reboot finishes the install
#   10 = VB-CABLE was already installed, nothing done
#   1  = failed
#
# The pack is unzipped to %ProgramData%\VoicePlay\vbcable and kept there, because the
# uninstaller needs VB-CABLE's setup program to remove it again.

param([Parameter(Mandatory = $true)][string]$ZipPath)

$ErrorActionPreference = "Stop"
$DeviceName = "VB-Audio Virtual Cable"

try {
    $existing = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.FriendlyName -like "*$DeviceName*" }
    if ($existing) {
        Write-Host "VB-CABLE already installed."
        exit 10
    }

    $dir = Join-Path $env:ProgramData "VoicePlay\vbcable"
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    New-Item -ItemType Directory -Force $dir | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $dir
    Copy-Item (Join-Path $PSScriptRoot "uninstall-vbcable.ps1") $dir

    # -i = install, -h = hide VB-CABLE's own windows. Community-reported switches, not
    # officially documented. Windows still shows its own "install this driver?" prompt.
    $setup = Join-Path $dir "VBCABLE_Setup_x64.exe"
    $proc = Start-Process -FilePath $setup -ArgumentList "-i", "-h" -Wait -PassThru
    Write-Host "VB-CABLE setup finished with exit code $($proc.ExitCode)."
    exit 0
}
catch {
    Write-Host "VB-CABLE install failed: $_"
    exit 1
}
