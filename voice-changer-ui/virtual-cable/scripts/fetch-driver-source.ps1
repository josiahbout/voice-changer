# Downloads the AudioMirror driver source (MIT) at a pinned commit into ..\driver.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File fetch-driver-source.ps1

$ErrorActionPreference = "Stop"

$Repo   = "JannesP/AudioMirror"
$Commit = "a9618d1ab4114e3e35e8e50ae804a4205315d1f2"
$Target = Join-Path $PSScriptRoot "..\driver"

if (Test-Path (Join-Path $Target "AudioMirror.sln")) {
    Write-Host "Driver source is already in $Target. Delete it first to re-fetch."
    exit 0
}

$work = Join-Path $env:TEMP "voiceplay-driver-$Commit"
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory $work | Out-Null

$zip = Join-Path $work "src.zip"
Write-Host "Downloading $Repo@$Commit ..."
Invoke-WebRequest "https://codeload.github.com/$Repo/zip/$Commit" -OutFile $zip
Expand-Archive $zip -DestinationPath $work

Copy-Item -Recurse -Force (Join-Path $work "AudioMirror-$Commit\*") $Target
Remove-Item -Recurse -Force $work

Write-Host "Done. Source is in $((Resolve-Path $Target).Path)"
Write-Host "Next: rebrand AudioMirror\AudioMirror.inf (see ..\README.md, step 2)."
