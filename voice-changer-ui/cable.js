// Virtual cable: finds the VoicePlay cable's speaker and sends converted audio into it,
// so games can record it from the "VoicePlay Mic". See virtual-cable/README.md.
// SCAFFOLD: nothing calls this yet.

// Matched against device labels: our own driver (upstream AudioMirror names until it is
// rebranded) and VB-CABLE, which ships with the app for now. VB-CABLE shows up as
// "CABLE Input (VB-Audio Virtual Cable)" (we play into it) and "CABLE Output (...)"
// (games record from it). Keep in sync with virtual-cable/scripts/check-cable.ps1.
const CABLE_NAMES = ["VoicePlay", "AudioMirror", "VB-Audio Virtual Cable"];

const isCable = (label) => CABLE_NAMES.some((name) => label.includes(name));

// Returns { output, input } device infos for the cable, or null if it isn't installed.
// Device labels are blank until the page has microphone permission, so call this after
// getUserMedia has succeeded.
async function findCable() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const output = devices.find((d) => d.kind === "audiooutput" && isCable(d.label));
  const input = devices.find((d) => d.kind === "audioinput" && isCable(d.label));
  return output ? { output, input } : null;
}

// Points an AudioContext's output at the cable. AudioContext.setSinkId is supported in
// Chrome and Edge (110+). Returns false if the cable or the API isn't available.
async function routeToCable(audioContext) {
  const cable = await findCable();
  if (!cable || typeof audioContext.setSinkId !== "function") return false;
  await audioContext.setSinkId(cable.output.deviceId);
  return true;
}

window.VoicePlayCable = { findCable, routeToCable };
