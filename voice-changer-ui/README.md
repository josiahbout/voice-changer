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

## Build the installer

```bash
npm run dist
```

This makes `dist/VoicePlay Setup <version>.exe`. The installer also sets up VB-CABLE (the
virtual audio cable) unless the user already has it, so it needs
`virtual-cable/vendor/VBCABLE_Driver_Pack45.zip` from [vb-cable.com](https://vb-cable.com).
That zip is committed unmodified, as its licence allows. See [virtual-cable/README.md](virtual-cable/README.md).

## Layout

```
index.html, styles.css, app.js   the UI
audio.js                         mic -> voice server -> output device
cable.js                         finds the virtual cable and routes audio into it
avatars/                         voice portraits
electron/                        desktop window and tray (main.js), its bridge to the page
                                 (preload.js), the voice server connection (server.js) and the
                                 error log (log.js)
build/installer.nsh              extra installer steps (VB-CABLE install / uninstall)
virtual-cable/                   virtual audio cable: VB-CABLE scripts now, our own driver later
```
