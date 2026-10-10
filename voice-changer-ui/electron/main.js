// Electron main process: opens the VoicePlay window, handles the custom title bar buttons,
// keeps VoicePlay in the system tray, runs the voice-changer server connection (see
// server.js) and keeps the error log (see log.js).
const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, shell, Tray } = require("electron");
const path = require("path");
const log = require("./log");
const server = require("./server");
const vbcable = require("./vbcable");

// Anything that slips through everywhere else still ends up in the log.
process.on("uncaughtException", (err) => log.error("main", "uncaught exception", err));
process.on("unhandledRejection", (reason) => log.error("main", "unhandled promise rejection", reason instanceof Error ? reason : { detail: String(reason) }));

const ICON = path.join(__dirname, "..", "assets", "icon.png");
// Tray icons with a status dot: blue while the voice is being changed, red when it isn't.
const TRAY_ICONS = {
  active: path.join(__dirname, "..", "assets", "tray-active.png"),
  idle: path.join(__dirname, "..", "assets", "tray-idle.png"),
};
const trayImage = (name) => nativeImage.createFromPath(TRAY_ICONS[name]).resize({ width: 32, height: 32, quality: "best" });

let win = null;
let tray = null;
let quitting = false; // closing the window only hides it to the tray, unless we're quitting
let toldAboutTray = false;

function createWindow() {
  // Always opens at this size; resizing isn't remembered.
  win = new BrowserWindow({
    width: 656,
    height: 729,
    minWidth: 420,
    minHeight: 560,
    frame: false, // the page draws its own minimize / expand / exit buttons
    backgroundColor: "#f6eef6",
    title: "VoicePlay",
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      // Keep converting the voice at full speed while the window is hidden in the tray.
      backgroundThrottling: false,
    },
  });

  // The exit button (and Alt+F4) hides VoicePlay to the tray; quit from the tray menu.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!toldAboutTray) {
      toldAboutTray = true;
      tray?.displayBalloon({
        iconType: "custom",
        icon: nativeImage.createFromPath(ICON),
        title: "VoicePlay is still running",
        content: "It's in the system tray. Right-click the icon to exit.",
      });
    }
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));
  // Web links (e.g. vb-cable.com in setup) open in the user's browser, never in an app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Safety net: never keep dragging once the window loses focus.
  win.on("blur", endDrag);

  // If the page crashes, log it and bring it back rather than leaving a blank window.
  win.webContents.on("render-process-gone", (_e, details) => {
    log.error("window", `page crashed (${details.reason}, exit code ${details.exitCode})`);
    if (!quitting && details.reason !== "clean-exit") setTimeout(() => win?.isDestroyed() || win.reload(), 1000);
  });
  win.webContents.on("unresponsive", () => log.warn("window", "page stopped responding"));
  win.webContents.on("responsive", () => log.info("window", "page is responding again"));
}

function openLogFolder() {
  const dir = log.dir();
  if (dir) shell.openPath(dir);
}

// Only one VoicePlay at a time; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    log.init(app.getPath("logs"), {
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
    });
    // Other Electron processes (GPU, audio service, ...) crashing.
    app.on("child-process-gone", (_e, details) => {
      if (details.reason !== "clean-exit") log.error("app", `${details.type} process gone (${details.reason}, exit code ${details.exitCode})`, details);
    });
    // The page only needs the microphone (and picking the speaker it plays to); deny everything else.
    const allowed = new Set(["media", "speaker-selection"]);
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(allowed.has(permission));
    });
    // Same answer for permission checks, so the device lists show real names.
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
    createWindow();
    createTray();
    server.start(path.join(app.getPath("logs"), "server.log"), (status) => {
      if (win && !win.isDestroyed()) win.webContents.send("server:status", status);
    });
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    server.stop();
    log.info("app", "quit");
    log.flush();
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(trayImage("idle"));
  tray.setToolTip("VoicePlay: voice changer off");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open VoicePlay", click: showWindow },
      { label: "Open log folder", click: openLogFolder },
      { type: "separator" },
      { label: "Exit VoicePlay", click: () => app.quit() },
    ]),
  );
  tray.on("click", showWindow);
}

ipcMain.on("window:minimize", () => win?.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on("window:close", () => win?.close());

// Window dragging, started and ended by the page (see app.js). CSS drag regions would be
// simpler, but they ignore the CSS cursor and we want a hand cursor over the drag area.
// While a drag is on, the window follows the mouse from where it was grabbed.
let dragTimer = null;

function endDrag() {
  clearInterval(dragTimer);
  dragTimer = null;
}

ipcMain.on("window:drag-start", () => {
  if (!win || win.isMaximized()) return;
  endDrag();
  const grab = screen.getCursorScreenPoint();
  const start = win.getBounds();
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return endDrag();
    const cursor = screen.getCursorScreenPoint();
    // setBounds with a fixed size: setPosition can grow the window across monitors with different scaling.
    win.setBounds({ ...start, x: start.x + cursor.x - grab.x, y: start.y + cursor.y - grab.y });
  }, 1000 / 120);
});
ipcMain.on("window:drag-end", endDrag);

ipcMain.on("tray:active", (_e, active) => {
  if (!tray) return;
  tray.setImage(trayImage(active ? "active" : "idle"));
  tray.setToolTip(active ? "VoicePlay: changing your voice" : "VoicePlay: voice changer off");
});

// Log entries from the page (see the "Error log" section of app.js).
const LOG_LEVELS = new Set(["info", "warn", "error"]);
ipcMain.on("log", (_e, level, source, message, details) => {
  if (LOG_LEVELS.has(level)) log.write(level, `page:${String(source).slice(0, 40)}`, String(message).slice(0, 2000), details);
});
ipcMain.on("logs:open", openLogFolder);

// VB-CABLE install from first-run setup (see vbcable.js).
ipcMain.handle("vbcable:install", () => vbcable.install());

ipcMain.handle("server:status", () => server.getStatus());
ipcMain.handle("server:info", () => server.info());
ipcMain.handle("server:update", (_e, key, val) => server.update(key, val));
ipcMain.handle("server:convert", (_e, pcm) => server.convert(pcm));
