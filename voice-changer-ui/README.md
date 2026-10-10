# VoicePlay

A real-time voice changer UI, built on top of the
[w-okada voice-changer](https://github.com/w-okada/voice-changer) server. Windows desktop
app built with [Electron](https://www.electronjs.org/).

## Run it

You need [Node.js](https://nodejs.org/) (LTS) installed.

```bash
npm install
npm start
```

You can also open `index.html` straight in a browser to work on the UI; the title bar
buttons and the voice changer itself only work inside the desktop app.

## Voice server

VoicePlay converts your voice with the voice-changer server in `../server`. On launch it
uses a server already running on port 18888 (for example from `server/start-server.bat`),
or starts one itself from `../server/.venv` (with `--no_client true`: one process, no
browser client) and stops it again on exit. If a server it started crashes, it restarts it,
up to 3 times in 10 minutes. The server's output goes to `%APPDATA%\voiceplay\logs\server.log`.

## Logs and bug reports

`electron/log.js` keeps `%APPDATA%\voiceplay\logs\voiceplay.log`: one JSON object per line,
starting each run with a "session started" line (app version, Windows version, CPU, RAM)
and then server status changes, the GPU the server found, and every error: uncaught errors
and rejected promises in the page and in the main process, error messages shown in the
status line, page crashes and hangs, and server crashes with the end of `server.log`.
Repeats of the same message within 10 s are collapsed into one line with a count. The log
moves to `voiceplay.old.log` past 5 MB (`server.log` to `server.old.log` past 10 MB).

Testers open the folder from **Settings > Report a problem…** or the tray icon's
**Open log folder**, and send both files with their report. From the page, log with
`logEvent(level, source, message, details)` (app.js); from the main process, with
`log.info/warn/error(source, message, details)`.

The page can't call the server directly (it rejects requests from `file://` pages), so the
Electron main process makes the calls for it: see `electron/server.js`, exposed to the page
as `window.voiceplay.server`. `audio.js` streams the mic to it in chunks and plays the
converted audio to the output device, which defaults to the virtual cable when installed.

Each voice card uses one of the server's model slots (`slot` in `VOICES`, `app.js`).
Cards whose slot has no model are greyed out until a model is loaded there.

## Build the alpha package

```bash
npm run package
```

This makes a ready-to-run folder, `dist/VoicePlay/` (start `VoicePlay.exe`), and zips it to
`dist/VoicePlay-<version>-alpha.zip` for sharing (several GB, so use Google Drive or OneDrive).
There's no installer: at about 10 GB the app is too big for one. Testers unzip it anywhere
and run `VoicePlay.exe`. `npm run package -- -NoZip` skips the zip.

The folder holds the app plus everything the voice server needs, so testers install nothing
else: the server code, base models and voices (`resources/server`) and Python with PyTorch
(`resources/python`, copied from `server/.venv`). The server writes its own small files to
`%LOCALAPPDATA%\VoicePlay\server`. VB-CABLE isn't installed by the package: first-run setup
offers to install it from `resources/vbcable`. See [build/package.ps1](build/package.ps1).

On start, VoicePlay checks for an NVIDIA card with driver 570 or newer, that Smart App Control
is off (it blocks the unsigned PyTorch files) and that port 18888 is free, and explains how to
fix any of these (see `electron/checks.js`).

## Layout

```
index.html, styles.css, app.js   the UI
audio.js                         mic -> voice server -> output device
cable.js                         finds the virtual cable and routes audio into it
avatars/                         voice portraits
electron/                        desktop window and tray (main.js), its bridge to the page
                                 (preload.js), the voice server connection (server.js), start-up
                                 checks (checks.js), VB-CABLE setup (vbcable.js) and the error log (log.js)
build/package.ps1                builds the portable alpha folder and zip
virtual-cable/                   virtual audio cable: VB-CABLE scripts now, our own driver later
```
