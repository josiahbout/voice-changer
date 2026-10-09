// Electron main process: opens the VoicePlay window and handles the custom title bar buttons.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("path");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 780,
    minWidth: 420,
    minHeight: 560,
    frame: false, // the page draws its own minimize / expand / exit buttons
    backgroundColor: "#f6eef6",
    title: "VoicePlay",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));
}

// Only one VoicePlay at a time; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // The page only needs the microphone; deny everything else.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === "media");
    });
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}

ipcMain.on("window:minimize", () => win?.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on("window:close", () => win?.close());
