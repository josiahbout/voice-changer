// Start-up checks for things outside VoicePlay that stop the voice server from working,
// so testers get a clear message instead of a server that never starts. Run before the
// server is started (see main.js). Each problem is { title, detail }.
const { execFile } = require("child_process");
const net = require("net");

// CUDA 12.8 (the PyTorch build we ship, needed for RTX 50-series cards) needs driver 570 or newer.
const MIN_DRIVER = 570;

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 15000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

async function checkGpu() {
  // nvidia-smi comes with the NVIDIA driver; no nvidia-smi means no NVIDIA driver.
  const out = await run("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"]);
  if (!out || !out.trim()) {
    return {
      title: "No NVIDIA graphics card found",
      detail: "VoicePlay changes your voice on an NVIDIA graphics card (GeForce GTX 10-series or newer). If you have one, install the latest driver from nvidia.com/drivers and start VoicePlay again.",
    };
  }
  const [name, version] = out.trim().split(/\r?\n/)[0].split(",").map((s) => s.trim());
  if (parseFloat(version) < MIN_DRIVER) {
    return {
      title: "Your NVIDIA driver is too old",
      detail: `Your ${name} has driver ${version}; VoicePlay needs ${MIN_DRIVER} or newer. Update it from nvidia.com/drivers (or the NVIDIA app) and start VoicePlay again.`,
    };
  }
  return null;
}

async function checkSmartAppControl() {
  // 0 = off, 1 = on, 2 = evaluation (watches, doesn't block).
  const out = await run("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy", "/v", "VerifiedAndReputablePolicyState"]);
  const match = out && out.match(/VerifiedAndReputablePolicyState\s+REG_DWORD\s+0x([0-9a-f]+)/i);
  if (match && parseInt(match[1], 16) === 1) {
    return {
      title: "Smart App Control will block VoicePlay",
      detail: "Windows' Smart App Control blocks parts of the voice engine that aren't signed yet. To use this alpha, turn it off in Windows Security > App & browser control > Smart App Control, then start VoicePlay again.",
    };
  }
  return null;
}

// Something other than the voice server already using its port.
function checkPort(port, serverAnswers) {
  return new Promise((resolve) => {
    if (serverAnswers) return resolve(null); // it's a voice server (ours, or one started by hand)
    const probe = net.createServer();
    probe.once("error", (err) =>
      resolve(
        err.code === "EADDRINUSE"
          ? { title: `Port ${port} is in use`, detail: `Another program is using port ${port}, which VoicePlay's voice engine needs. Close it (or restart your PC) and start VoicePlay again.` }
          : null,
      ),
    );
    probe.once("listening", () => probe.close(() => resolve(null)));
    probe.listen(port, "127.0.0.1");
  });
}

async function runAll({ port, serverAnswers }) {
  const results = await Promise.all([checkGpu(), checkSmartAppControl(), checkPort(port, serverAnswers)]);
  return results.filter(Boolean);
}

module.exports = { runAll };
