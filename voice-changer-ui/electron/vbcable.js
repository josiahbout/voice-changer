// Installs VB-CABLE (the virtual audio cable games record VoicePlay from) from inside the
// app, during first-run setup. Run in the Electron main process.
//
// VB-CABLE's licence allows sharing its package "as is" but not integrating it into another
// installer without VB-Audio's agreement, so this doesn't install it silently: it unpacks
// the official, unmodified driver pack and opens VB-Audio's own setup window (after the
// Windows admin prompt), where the user clicks "Install Driver" themselves.
// See virtual-cable/README.md.
const { app } = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const log = require("./log");

const PACK = "VBCABLE_Driver_Pack45.zip";
const DEVICE_NAME = "VB-Audio Virtual Cable";

// The pack ships next to the app: in resources/vbcable when packaged (see "extraResources"
// in package.json), in virtual-cable/vendor in development.
const packPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, "vbcable", PACK) : path.join(__dirname, "..", "virtual-cable", "vendor", PACK);

// PowerShell single-quoted string literal.
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function powershell(script) {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function isInstalled() {
  const r = await powershell(`if (Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like ${psQuote(`*${DEVICE_NAME}*`)} }) { exit 0 } else { exit 3 }`);
  return r.code === 0;
}

// Returns { installed, cancelled, message }.
async function install() {
  if (await isInstalled()) return { installed: true, cancelled: false, message: "already installed" };

  const dir = path.join(app.getPath("userData"), "vbcable");
  log.info("vbcable", "unpacking driver pack", { pack: packPath(), dir });
  const unzip = await powershell(`Expand-Archive -Force -Path ${psQuote(packPath())} -DestinationPath ${psQuote(dir)}`);
  if (unzip.code !== 0) {
    log.error("vbcable", "couldn't unpack the driver pack", unzip);
    return { installed: false, cancelled: false, message: "Couldn't unpack VB-CABLE." };
  }

  // -Verb RunAs shows the Windows admin prompt; saying no throws, which we report as 1223
  // (Windows' "cancelled by the user").
  const setup = path.join(dir, "VBCABLE_Setup_x64.exe");
  log.info("vbcable", "opening VB-CABLE setup");
  const run = await powershell(`try { $p = Start-Process -FilePath ${psQuote(setup)} -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }`);
  if (run.code === 1223) {
    log.warn("vbcable", "admin prompt declined");
    return { installed: false, cancelled: true, message: "The Windows prompt was declined." };
  }

  const installed = await isInstalled();
  log.info("vbcable", `setup closed (exit code ${run.code}); cable present: ${installed}`);
  return { installed, cancelled: false, message: installed ? "installed" : "VB-CABLE setup closed without installing the cable." };
}

module.exports = { install, isInstalled };
