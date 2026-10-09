// Exposes a small, safe API to the page as `window.voiceplay`.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voiceplay", {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
});
