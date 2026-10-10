@echo off
rem Opens VoicePlay (it starts the voice server itself). Double-click to run.
rem Needs `npm install` to have been run in this folder once.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron isn't installed. Run "npm install" in this folder first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
