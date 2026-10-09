# Reports whether the VoicePlay cable is installed. Read-only, no admin needed.
# Exit code: 0 = installed, 1 = not installed.

# Our own driver (upstream AudioMirror names until it is rebranded) and VB-CABLE.
$Names = @("VoicePlay", "AudioMirror", "VB-Audio Virtual Cable")

$devices = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {
    $n = $_.FriendlyName
    $n -and ($Names | Where-Object { $n -like "*$_*" })
}

if ($devices) {
    $devices | Select-Object Class, FriendlyName, Status | Format-Table -AutoSize
    exit 0
}

Write-Host "No virtual cable (VoicePlay or VB-CABLE) is installed."
exit 1
