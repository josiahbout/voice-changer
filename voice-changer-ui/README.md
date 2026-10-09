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
buttons only do something inside the desktop app.

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
cable.js                         finds the virtual cable and routes audio into it
avatars/                         voice portraits
electron/                        desktop window (main.js) and its bridge to the page (preload.js)
build/installer.nsh              extra installer steps (VB-CABLE install / uninstall)
virtual-cable/                   virtual audio cable: VB-CABLE scripts now, our own driver later
```
