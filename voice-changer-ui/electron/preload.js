// Exposes a small, safe API to the page as `window.voiceplay`.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voiceplay", {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  dragStart: () => ipcRenderer.send("window:drag-start"),
  dragEnd: () => ipcRenderer.send("window:drag-end"),
  // Blue dot on the tray icon while the voice is being changed, red otherwise.
  setActive: (active) => ipcRenderer.send("tray:active", active),

  // Error log (see electron/log.js). level: "info" | "warn" | "error".
  log: (level, source, message, details) => ipcRenderer.send("log", level, source, message, details),
  openLogFolder: () => ipcRenderer.send("logs:open"),

  // Voice-changer server (see electron/server.js).
  server: {
    status: () => ipcRenderer.invoke("server:status"),
    onStatus: (listener) => ipcRenderer.on("server:status", (_e, status) => listener(status)),
    info: () => ipcRenderer.invoke("server:info"),
    update: (key, val) => ipcRenderer.invoke("server:update", key, val),
    convert: (pcm) => ipcRenderer.invoke("server:convert", pcm),
  },
});
