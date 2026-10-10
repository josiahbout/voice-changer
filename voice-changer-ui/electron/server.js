// Voice-changer server bridge, run in the Electron main process.
// Starts the Python server from ../server if it isn't already running, restarts it if it
// crashes, and makes its HTTP calls on the page's behalf: the server rejects requests from
// file:// pages (Origin "null"), and requests from Node carry no Origin header at all.
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const checks = require("./checks");
const log = require("./log");

const HOST = "127.0.0.1";
const PORT = 18888;

// Where the server's code, Python and data live.
// - Development: ../server with its .venv, and the server writes into ../server.
// - Packaged (the portable VoicePlay folder, see build/package.ps1): the code, base models
//   and voices are in resources/server, Python in resources/python. The server runs in
//   %LOCALAPPDATA%\VoicePlay\server, so the small files it writes (its own settings, temp
//   files) stay out of the app folder; voices are read from resources/server/model_dir.
const PACKAGED = require("electron").app.isPackaged;
const SERVER_DIR = PACKAGED ? path.join(process.resourcesPath, "server") : path.resolve(__dirname, "..", "..", "server");
const PYTHON = PACKAGED ? path.join(process.resourcesPath, "python", "python.exe") : path.join(SERVER_DIR, ".venv", "Scripts", "python.exe");
const WORK_DIR = PACKAGED ? path.join(process.env.LOCALAPPDATA || require("os").tmpdir(), "VoicePlay", "server") : SERVER_DIR;

// Command-line arguments. --no_client: one process, and no attempt to open the server's own client window.
function serverArgs() {
  const args = [path.join(SERVER_DIR, "MMVCServerSIO.py"), "-p", String(PORT), "--https", "false", "--no_client", "true"];
  if (!PACKAGED) return args;
  // The server's default paths are relative to where it runs; point them at the app folder.
  const pretrain = (file) => path.join(SERVER_DIR, "pretrain", file);
  return args.concat([
    "--model_dir", path.join(SERVER_DIR, "model_dir"),
    "--content_vec_500", pretrain("checkpoint_best_legacy_500.pt"),
    "--content_vec_500_onnx", pretrain("content_vec_500.onnx"),
    "--hubert_base", pretrain("hubert_base.pt"),
    "--hubert_base_jp", pretrain("rinna_hubert_base_jp.pt"),
    "--hubert_soft", pretrain(path.join("hubert", "hubert-soft-0d54a1f4.pt")),
    "--whisper_tiny", pretrain("whisper_tiny.pt"),
    "--nsf_hifigan", pretrain(path.join("nsf_hifigan", "model")),
    "--crepe_onnx_full", pretrain("crepe_onnx_full.onnx"),
    "--crepe_onnx_tiny", pretrain("crepe_onnx_tiny.onnx"),
    "--rmvpe", pretrain("rmvpe.pt"),
    "--rmvpe_onnx", pretrain("rmvpe.onnx"),
  ]);
}
// The first start downloads ~1 GB of base models, so allow plenty of time.
const START_TIMEOUT_MS = 15 * 60 * 1000;
// If the server crashes, start it again, but give up after this many crashes in RESTART_WINDOW_MS.
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const MAX_SERVER_LOG_BYTES = 10 * 1024 * 1024;

// "starting" | "ready" | "missing" (no server or Python env found)
// | "blocked" (a start-up check failed, see checks.js) | "stopped"
let status = "stopped";
let child = null; // only set when we started the server ourselves
let stopping = false; // we're stopping it on purpose, so an exit isn't a crash
let crashes = []; // times of recent crashes
let serverLogFile = null;
let onStatus = () => {};
let onProblems = () => {};

function setStatus(next) {
  if (next !== status) log.info("server", `status: ${next}`);
  status = next;
  onStatus(status);
}

// ---------- HTTP ----------

// One kept-alive connection, with Nagle's algorithm off. Node's fetch() made every request
// wait about 13 ms longer on Windows (15 ms instead of 2 ms for a 500 ms chunk).
const agent = new http.Agent({ keepAlive: true });

// The default timeout is generous: the first conversion after the server starts (or after
// a voice loads) warms up the GPU and can take well over 30 s. It only catches a server that
// has stopped answering altogether.
function request(method, urlPath, { body, headers = {}, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method, agent, timeout, headers: body === undefined ? headers : { ...headers, "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        const parts = [];
        res.on("data", (d) => parts.push(d));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }));
        res.on("error", reject);
      },
    );
    req.on("socket", (socket) => socket.setNoDelay(true));
    req.on("timeout", () => req.destroy(new Error(`${method} ${urlPath} timed out after ${timeout} ms`)));
    req.on("error", reject);
    req.end(body);
  });
}

async function requestJson(method, urlPath, options) {
  const res = await request(method, urlPath, options);
  const text = res.body.toString("utf8");
  if (res.status !== 200) throw new Error(`${method} ${urlPath} failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function isUp() {
  try {
    return (await request("GET", "/api/hello", { timeout: 2000 })).status === 200;
  } catch {
    return false;
  }
}

// ---------- Starting and stopping ----------

function rotateServerLog() {
  try {
    if (fs.statSync(serverLogFile).size > MAX_SERVER_LOG_BYTES) fs.renameSync(serverLogFile, serverLogFile.replace(/\.log$/, ".old.log"));
  } catch {
    // No log yet.
  }
}

// The end of the server's output, to explain a crash in the app log.
function serverLogTail(lines = 30) {
  try {
    const text = fs.readFileSync(serverLogFile, "utf8");
    return text.split(/\r?\n/).filter((l) => l.trim() && !l.includes("%|")).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function spawnServer() {
  rotateServerLog();
  const out = fs.openSync(serverLogFile, "a");
  stopping = false;
  fs.mkdirSync(WORK_DIR, { recursive: true });
  child = spawn(PYTHON, serverArgs(), {
    cwd: WORK_DIR,
    env: {
      ...process.env,
      // PyTorch 2.6+ refuses older model checkpoints unless this is set.
      TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: "1",
      PYTHONIOENCODING: "utf-8",
      // Write print() output to the log straight away; otherwise it's buffered and lost on exit.
      PYTHONUNBUFFERED: "1",
      // The bundled Python must only use its own packages, never ones installed for the user.
      ...(PACKAGED ? { PYTHONNOUSERSITE: "1", PYTHONHOME: "", PYTHONPATH: "" } : {}),
    },
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  log.info("server", `started (pid ${child.pid})`);
  child.on("error", (err) => log.error("server", "couldn't start the voice server", err));
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return setStatus("stopped");
    log.error("server", `voice server exited unexpectedly (code ${code}, signal ${signal})`, { serverLogTail: serverLogTail() });
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < RESTART_WINDOW_MS).concat(now);
    if (crashes.length > MAX_RESTARTS) {
      log.error("server", `gave up restarting after ${MAX_RESTARTS} crashes in ${RESTART_WINDOW_MS / 60000} minutes`);
      return setStatus("stopped");
    }
    log.warn("server", `restarting (crash ${crashes.length} of ${MAX_RESTARTS} allowed)`);
    waitForServer();
  });
}

// Starts the server (if needed) and waits for it to answer.
async function waitForServer() {
  setStatus("starting");
  if (await isUp()) return setStatus("ready");
  if (!fs.existsSync(PYTHON)) {
    log.error("server", `Python environment not found at ${PYTHON}`);
    return setStatus("missing");
  }
  const problems = await checks.runAll({ port: PORT, serverAnswers: false });
  if (problems.length) {
    log.error("server", "start-up checks failed", { problems });
    setStatus("blocked");
    return onProblems(problems);
  }
  spawnServer();
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (child && Date.now() < deadline) {
    if (await isUp()) return setStatus("ready");
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (child) {
    log.error("server", `voice server didn't answer within ${START_TIMEOUT_MS / 60000} minutes`, { serverLogTail: serverLogTail() });
    stop();
  }
}

// Uses a server that's already running (e.g. from start-server.bat), otherwise starts one.
// problemsListener gets the failed start-up checks, if any (see checks.js).
function start(logFile, statusListener, problemsListener) {
  serverLogFile = logFile;
  onStatus = statusListener;
  onProblems = problemsListener;
  return waitForServer();
}

// Stops the server only if we started it. Kill the whole process tree, and wait for it:
// this runs as the app quits, which would otherwise cut it short.
function stop() {
  if (!child) return;
  stopping = true;
  try {
    execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {
    // Already exited.
  }
  child = null;
}

// ---------- API ----------

const info = () => requestJson("GET", "/info");

function update(key, val) {
  const body = `key=${encodeURIComponent(key)}&val=${encodeURIComponent(String(val))}`;
  return requestJson("POST", "/update_settings", { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}

// Sends 48 kHz mono Int16 PCM and returns the converted audio in the same format.
async function convert(pcm) {
  const body = JSON.stringify({ timestamp: Date.now(), buffer: Buffer.from(pcm).toString("base64") });
  const result = await requestJson("POST", "/test", { body, headers: { "Content-Type": "application/json" } });
  // On failure the server answers with the error message as a bare string.
  if (typeof result !== "object" || !result.changedVoiceBase64) throw new Error(`voice server: ${String(result).slice(0, 300)}`);
  const out = Buffer.from(result.changedVoiceBase64, "base64");
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

module.exports = { start, stop, info, update, convert, getStatus: () => status };
