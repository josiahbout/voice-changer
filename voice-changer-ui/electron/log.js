// Error and event log for alpha testing, run in the Electron main process.
// Writes one JSON object per line to %APPDATA%\voiceplay\logs\voiceplay.log, so testers can
// send the logs folder with a bug report (tray menu > "Open log folder"). Each run starts
// with a session line describing the app and computer. The page logs through IPC (see
// preload.js), the server's own output goes to server.log next to it.
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_BYTES = 5 * 1024 * 1024; // then voiceplay.log becomes voiceplay.old.log
const REPEAT_WINDOW_MS = 10000; // identical messages within this are counted, not repeated

let file = null;
let last = null; // { key, time, count } of the last message, to collapse repeats

function init(dir, appInfo) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, "voiceplay.log");
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, path.join(dir, "voiceplay.old.log"));
  } catch {
    // No log yet.
  }
  write("info", "app", "session started", {
    ...appInfo,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: os.cpus()[0]?.model,
    ramGB: Math.round(os.totalmem() / 1024 ** 3),
  });
}

// Errors don't survive JSON.stringify, so keep what's useful from them.
function plain(value) {
  if (value instanceof Error) return { error: value.message, stack: value.stack };
  if (value && typeof value === "object") return value;
  return value === undefined ? {} : { detail: String(value) };
}

function flushRepeats() {
  if (last && last.count > 1) append({ time: new Date().toISOString(), level: last.level, source: last.source, message: `(the message above repeated ${last.count - 1} more times)` });
}

function append(entry) {
  if (!file) return;
  try {
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // Never let logging take the app down.
  }
}

function write(level, source, message, details) {
  const key = `${level}|${source}|${message}`;
  const now = Date.now();
  if (last && last.key === key && now - last.time < REPEAT_WINDOW_MS) {
    last.count++;
    last.time = now;
    return;
  }
  flushRepeats();
  last = { key, level, source, time: now, count: 1 };
  append({ time: new Date(now).toISOString(), level, source, message, ...plain(details) });
  if (level === "error") console.error(`[${source}] ${message}`, details ?? "");
}

module.exports = {
  init,
  info: (source, message, details) => write("info", source, message, details),
  warn: (source, message, details) => write("warn", source, message, details),
  error: (source, message, details) => write("error", source, message, details),
  write,
  flush: flushRepeats,
  dir: () => (file ? path.dirname(file) : null),
};
