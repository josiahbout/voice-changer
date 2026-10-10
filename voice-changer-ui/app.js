// ---------- Error log ----------

// Problems go to the app's log file (electron/log.js), so alpha testers can send it with a
// bug report. First in the file so it also catches errors while the page is setting up.
// Error messages shown in the status line are logged too (see showStatus).
const logEvent = (level, source, message, details) => window.voiceplay?.log(level, source, message, details);

window.addEventListener("error", (e) =>
  logEvent("error", "uncaught", e.message, { file: e.filename, line: e.lineno, column: e.colno, stack: e.error?.stack }),
);
window.addEventListener("unhandledrejection", (e) =>
  logEvent("error", "promise", String(e.reason?.message ?? e.reason), { stack: e.reason?.stack }),
);

// Voices shown in the picker. Portraits live in avatars/. `slot` is the voice-changer
// server's model slot that holds this voice's model; voices whose slot is empty show as
// unavailable until a model is loaded there.
// The comments name the model loaded in each slot (from the repo's voices/ folder).
// `gender` picks the voice's group in the picker and its starting pitch (see RANGE_PITCH).
const VOICES = [
  { id: "sweetheart", name: "Mr. Sweetheart", image: "avatars/sweetheart.png", slot: 0, gender: "male" }, // voice_charles
  { id: "bro", name: "Mr. Bro", image: "avatars/bro.png", slot: 1, gender: "male" }, // voice_ScaredySquirrel
  { id: "gentleman", name: "Mr. Gentleman", image: "avatars/gentleman.png", slot: 2, gender: "male" }, // voice_RinnosukeGenso
  { id: "rockstar", name: "Mr. Rockstar", image: "avatars/rockstar.png", slot: 3, gender: "male" }, // voice_WillWood
  { id: "nerd", name: "Mr. Nerd", image: "avatars/nerd.png", slot: 4, gender: "male" }, // voice_PeterGriffin
  { id: "veteran", name: "Mr. Veteran", image: "avatars/veteran.png", slot: 5, gender: "male" }, // voice_MorganFreeman
  { id: "gamer", name: "Ms. Gamer", image: "avatars/gamer.png", slot: 6, gender: "female" }, // voice_Ms Gamer
  { id: "quirky", name: "Ms. Quirky", image: "avatars/quirky.png", slot: 7, gender: "female" }, // server sample: Kikoto Kurage
  { id: "shy", name: "Ms. Shy", image: "avatars/shy.png", slot: 8, gender: "female" }, // server sample: Tsukuyomi-chan
  { id: "energetic", name: "Ms. Energetic", image: "avatars/energetic.png", slot: 9, gender: "female" }, // server sample: Amitaro
];

const VOICE_GROUPS = [
  { gender: "male", title: "Male voices" },
  { gender: "female", title: "Female voices" },
];

// Each voice's starting pitch, from the first-run answer: voices that match the user's
// range start at 0, the others are shifted. Once the user moves a voice's pitch slider,
// that voice keeps their value instead (state.pitches).
const RANGE_PITCH = {
  deeper: { male: 0, female: 14 },
  higher: { male: -12, female: 0 },
};

// Chunk sizes offered in settings, in samples at 48 kHz: how much audio goes to the
// server per conversion. Smaller is lower latency but needs a faster GPU.
const CHUNK_SIZES = [2400, 4800, 7200, 9600, 12000, 14400, 19200, 24000, 28800, 38400, 48000];

// Effects in the voice adjustments pop-up, applied to the changed voice (see createEffects
// in audio.js, which uses these ids and param keys). All start switched off.
const pct = (v) => `${v}%`;
const EFFECTS = [
  { id: "reverb", name: "Reverb", tip: "Sounds like you're in a room, hall or cave.", params: [
    { key: "size", label: "Room size", min: 0.5, max: 5, step: 0.5, value: 2, format: (v) => `${v}s` },
    { key: "mix", label: "Amount", min: 0, max: 100, step: 1, value: 30, format: pct },
  ] },
  { id: "echo", name: "Echo", tip: "Repeats your voice, fading each time.", params: [
    { key: "time", label: "Delay", min: 50, max: 1000, step: 10, value: 300, format: (v) => `${v} ms` },
    { key: "feedback", label: "Repeats", min: 0, max: 80, step: 1, value: 40, format: pct },
    { key: "mix", label: "Amount", min: 0, max: 100, step: 1, value: 35, format: pct },
  ] },
  { id: "telephone", name: "Telephone", tip: "Sounds like you're talking over a phone line.", params: [
    { key: "muffle", label: "Muffle", min: 0, max: 100, step: 1, value: 30, format: pct },
  ] },
  { id: "megaphone", name: "Megaphone", tip: "Loud, distorted and cuts through.", params: [
    { key: "drive", label: "Distortion", min: 0, max: 100, step: 1, value: 50, format: pct },
  ] },
  { id: "robot", name: "Robot", tip: "Metallic, synthetic voice.", params: [
    { key: "tone", label: "Tone", min: 30, max: 200, step: 5, value: 60, format: (v) => `${v} Hz` },
  ] },
  { id: "eq", name: "Bass & treble", tip: "Warms up or brightens the voice.", params: [
    { key: "bass", label: "Bass", min: -12, max: 12, step: 1, value: 0, format: (v) => `${v > 0 ? "+" : ""}${v} dB` },
    { key: "treble", label: "Treble", min: -12, max: 12, step: 1, value: 0, format: (v) => `${v > 0 ? "+" : ""}${v} dB` },
  ] },
  { id: "leveler", name: "Leveler", tip: "Evens out loud and quiet speech, so you don't blast people in voice chat.", params: [
    { key: "strength", label: "Strength", min: 0, max: 100, step: 1, value: 50, format: pct },
  ] },
];

const defaultEffects = () =>
  Object.fromEntries(EFFECTS.map((fx) => [fx.id, { on: false, ...Object.fromEntries(fx.params.map((p) => [p.key, p.value])) }]));

const state = {
  selected: "gentleman",
  talking: false,
  playingFile: null, // name of the audio file being played in the selected voice
  listening: false, // loopback test: hear your own converted voice
  inputDevice: "default",
  outputDevice: "default",
  volume: 100, // percent
  pitches: {}, // { voiceId: semitones } for voices whose pitch the user has set; see voicePitch
  voiceRange: null, // "deeper" | "higher", asked on first run (see Onboarding)
  reduceNoise: false,
  sensitivity: 99, // percent; the server's noise gate, see sensitivityToThreshold
  inputGain: 100, // percent; mic (or file) level before conversion
  indexRatio: 75, // percent; the server's indexRatio (0..1)
  protect: 33, // percent; the server's protect, inverted (see protectToServer)
  gpu: 0,
  // These five start at the "Smooth" stop of the delay slider (see SPEED_PRESETS).
  chunk: 24000, // samples (500 ms)
  extra: 32768, // samples of earlier audio given as context (the server's extraConvertSize)
  crossfade: 4096, // samples each chunk blends into the next (the server's crossFadeOverlapSize)
  highQuality: true, // the server's rvcQuality
  trackPitch: false, // also track pitch in the Extra audio; the server's silenceFront, inverted
  f0Detector: "rmvpe_onnx", // pitch detection: "rmvpe_onnx" (accurate) or "fcpe" (about a third faster)
  effects: defaultEffects(), // { reverb: { on, size, mix }, ... }
  server: "stopped", // see electron/server.js
  filledSlots: null, // slot indexes that hold a model, once the server has told us
};

// ---------- Saved preferences ----------

// Settings the user picks are kept between runs (in the app's local storage).
const PREF_KEYS = [
  "selected", "inputDevice", "outputDevice", "volume", "pitches", "reduceNoise", "sensitivity",
  "inputGain", "indexRatio", "protect", "gpu", "chunk", "voiceRange",
  "extra", "crossfade", "highQuality", "trackPitch", "f0Detector", "effects",
];
const PREFS_STORAGE = "voiceplay.prefs";

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_STORAGE)) || {};
  } catch {
    return {};
  }
}

const savedPrefs = loadPrefs();
for (const key of PREF_KEYS) if (key in savedPrefs) state[key] = savedPrefs[key];
if (!VOICES.some((v) => v.id === state.selected)) state.selected = "gentleman";
// Older versions saved this setting the other way round, as "Fast Extra".
if (!("trackPitch" in savedPrefs) && "fastExtra" in savedPrefs) state.trackPitch = !savedPrefs.fastExtra;
// Saved effects are laid over the defaults, so effects added in later versions still appear.
state.effects = Object.fromEntries(
  Object.entries(defaultEffects()).map(([id, fx]) => [id, { ...fx, ...savedPrefs.effects?.[id] }]),
);

function savePrefs() {
  const prefs = Object.fromEntries(PREF_KEYS.map((k) => [k, state[k]]));
  try {
    localStorage.setItem(PREFS_STORAGE, JSON.stringify(prefs));
  } catch (err) {
    console.warn("Couldn't save preferences:", err);
  }
}

// window.voiceplay only exists inside the Electron app (see electron/preload.js).
const server = window.voiceplay?.server;
const audio = window.VoicePlayAudio;

// ---------- Tooltips ----------

// Anything with a data-tip shows it in a small bubble after a short hover, or straight away
// on keyboard focus. Buttons that toggle update their tip with setTip.
const tooltip = document.getElementById("tooltip");
const TIP_DELAY_MS = 450;
let tipTarget = null; // element whose tip is showing
let hoverTarget = null; // element with a tip under the mouse, shown or waiting to be
let tipTimer = null;
let keyboardNav = false; // tips on focus only while the user is tabbing around

function placeTip() {
  const r = tipTarget.getBoundingClientRect();
  const t = tooltip.getBoundingClientRect();
  const gap = 8;
  const clamp = (v, max) => Math.min(Math.max(8, v), max);
  // Settings tips sit to the left of the settings pop-up so they don't cover the other settings.
  const popover = tipTarget.closest(".popover-settings");
  if (popover) {
    tooltip.style.top = `${clamp(r.top + r.height / 2 - t.height / 2, window.innerHeight - t.height - 8)}px`;
    tooltip.style.left = `${Math.max(8, popover.getBoundingClientRect().left - t.width - gap)}px`;
    return;
  }
  // Below things near the top of the window (the header), above everything else.
  const top = r.top < 120 ? r.bottom + gap : r.top - t.height - gap;
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${clamp(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 8)}px`;
}

function showTip(el) {
  // Inside the onboarding dialog the bubble has to live in the dialog to appear above it.
  (el.closest("dialog") || document.body).append(tooltip);
  tipTarget = el;
  tooltip.textContent = el.dataset.tip;
  tooltip.hidden = false;
  placeTip();
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = null;
  hoverTarget = null;
  tooltip.hidden = true;
}

function setTip(el, text) {
  el.dataset.tip = text;
  if (tipTarget === el) {
    tooltip.textContent = text;
    placeTip();
  }
}

document.addEventListener("pointerover", (e) => {
  keyboardNav = false;
  const el = e.target.closest("[data-tip]");
  // Compare with what's hovered, not what's shown: otherwise a tip still waiting to appear
  // would pop up after the mouse had already moved off its button.
  if (el === hoverTarget) return;
  hideTip();
  hoverTarget = el;
  // No tip for a button whose pop-up is already open.
  if (!el || el.getAttribute("aria-expanded") === "true") return;
  tipTimer = setTimeout(() => {
    if (el === hoverTarget && el.matches(":hover")) showTip(el);
  }, TIP_DELAY_MS);
});
document.addEventListener("focusin", (e) => {
  const el = e.target.closest("[data-tip]");
  if (el && keyboardNav && el.matches(":focus-visible")) showTip(el);
});
document.addEventListener("focusout", () => {
  if (keyboardNav) hideTip();
});
document.addEventListener("pointerdown", hideTip);
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab") keyboardNav = true;
  if (e.key === "Escape") hideTip();
});
window.addEventListener("blur", hideTip);
window.addEventListener("resize", hideTip);
document.addEventListener("scroll", hideTip, true);

// ---------- Status line ----------

const statusEl = document.getElementById("status");

function showStatus(text, kind = "info") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
  if (kind === "error") logEvent("error", "status", text);
}

const currentVoice = () => VOICES.find((v) => v.id === state.selected);

// The pitch (the server's "tran", in semitones) to use for a voice.
const voicePitch = (voice) => state.pitches[voice.id] ?? RANGE_PITCH[state.voiceRange ?? "deeper"][voice.gender];
const hasModel = (voice) => !state.filledSlots || state.filledSlots.has(voice.slot);

function showReadyStatus() {
  const voice = currentVoice();
  if (!hasModel(voice)) showStatus(`${voice.name} has no voice model yet (server slot ${voice.slot}).`, "warn");
  else if (state.playingFile) showStatus(`Playing "${state.playingFile}" as ${voice.name}`, "ok");
  else showStatus("", "ok");
}

// ---------- Loading ring around the mic ----------

const micWrap = document.querySelector(".mic-wrap");
let loadToken = 0;

function setLoading(on) {
  micWrap.dataset.loading = on;
  document.getElementById("mic-btn").setAttribute("aria-busy", on);
}

// ---------- Voice cards ----------

// Cards are grouped under a heading per gender (headings span the whole grid row).
function renderVoices() {
  const root = document.getElementById("voices");
  const card = (v) => `
    <div class="voice" role="radio" tabindex="0" data-id="${v.id}" aria-checked="${v.id === state.selected}"${hasModel(v) ? "" : ' data-empty="true" data-tip="No voice model loaded for this voice yet"'}>
      <div class="avatar"><img src="${v.image}" alt=""></div>
      <div class="voice-name">${v.name}</div>
    </div>`;
  root.innerHTML = VOICE_GROUPS.map((g) => `
    <h2 class="voice-group" role="presentation">${g.title}</h2>
    ${VOICES.filter((v) => v.gender === g.gender).map(card).join("")}`).join("");
}

async function selectVoice(id) {
  const voice = VOICES.find((v) => v.id === id);
  if (!hasModel(voice)) return showStatus(`${voice.name} has no voice model yet (server slot ${voice.slot}).`, "warn");
  state.selected = id;
  savePrefs();
  renderVoices();
  showVoicePitch();
  await applyVoice();
}

// Protect: the server's value runs 0.5 (off) down to 0 (strongest); the slider is the
// other way round, so higher means more protection.
const protectToServer = (percent) => (0.5 * (100 - percent)) / 100;

// Quality settings that live on the server. Switching models resets some of them (and
// the server may have kept old values from another client), so they're all re-sent.
const qualitySettings = () => ({
  extraConvertSize: state.extra,
  crossFadeOverlapSize: state.crossfade,
  rvcQuality: state.highQuality ? 1 : 0,
  silenceFront: state.trackPitch ? 0 : 1,
  f0Detector: state.f0Detector,
});

// Loads the selected voice's model on the server. Pitch, index, protect and the quality
// settings are re-sent afterwards because switching models resets them to the model's defaults.
async function applyVoice() {
  if (state.server !== "ready") return;
  const voice = currentVoice();
  if (!hasModel(voice)) return showReadyStatus();
  const token = ++loadToken;
  showStatus("");
  setLoading(true);
  try {
    await server.update("modelSlotIndex", voice.slot);
    await server.update("tran", voicePitch(voice));
    await server.update("indexRatio", state.indexRatio / 100);
    await server.update("protect", protectToServer(state.protect));
    for (const [key, val] of Object.entries(qualitySettings())) await server.update(key, val);
    // The first conversion after loading a model is slow (GPU warm-up), so do it now rather
    // than on the user's first words. Quiet noise rather than silence, which the server skips.
    const warmup = new Int16Array(state.chunk).map(() => (Math.random() - 0.5) * 2000);
    await server.convert(warmup.buffer);
    measureDelay(); // each voice converts at its own speed
    if (voice === currentVoice()) showReadyStatus();
  } catch (err) {
    showStatus(`Couldn't load ${voice.name}: ${err.message}`, "error");
  } finally {
    // A newer voice switch owns the ring now; leave it spinning for that one.
    if (token === loadToken) setLoading(false);
  }
}

document.getElementById("voices").addEventListener("click", (e) => {
  const card = e.target.closest(".voice");
  if (card) selectVoice(card.dataset.id);
});

document.getElementById("voices").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("voice")) {
    e.preventDefault();
    selectVoice(e.target.dataset.id);
    document.querySelector(`.voice[data-id="${state.selected}"]`).focus();
  }
});

// ---------- Mic ----------

// Streams the mic through the server while on (see audio.js).
const micBtn = document.getElementById("mic-btn");

// Tells the tray icon whether the voice is being changed right now (mic or file).
function updateTrayStatus() {
  window.voiceplay?.setActive(state.talking || !!state.playingFile);
}

function setMicButton(on) {
  state.talking = on;
  updateTrayStatus();
  micBtn.setAttribute("aria-pressed", String(on));
  micBtn.setAttribute("aria-label", on ? "Stop talking" : "Tap to talk");
  setTip(micBtn, on ? "Stop talking" : "Start talking in this voice");
}

let lastAudioError = 0;

function onAudioError(err) {
  // Conversion errors arrive once per chunk; don't flood the status line.
  if (Date.now() - lastAudioError < 2000) return;
  lastAudioError = Date.now();
  showStatus(`Voice server error: ${err.message}`, "error");
}

async function startTalking() {
  await audio.startVoice({ ...state, onError: onAudioError, onTiming: recordConversionTime, onLatency: showDelay });
  // Device names are only visible once the mic is allowed, so look for the virtual cable now.
  if (state.outputDevice === "default") {
    const cable = await window.VoicePlayCable.findCable();
    if (cable) {
      state.outputDevice = cable.output.deviceId;
      savePrefs();
      await audio.setOutputDevice(state.outputDevice);
    }
  }
  await refreshDevices();
}

async function setTalking(on) {
  if (!on) {
    audio.stopVoice();
    setMicButton(false);
    showDelay(); // back to the estimate
    if (state.server === "ready") showReadyStatus();
    return;
  }
  if (!server) return showStatus("Open VoicePlay in the desktop app to use the voice changer.", "warn");
  if (state.server !== "ready") return showStatus("The voice server isn't ready yet.", "warn");
  if (!hasModel(currentVoice())) return showReadyStatus();
  setFileButton(null); // the mic takes over from any file that's playing
  setMicButton(true);
  try {
    await startTalking();
    showReadyStatus();
  } catch (err) {
    audio.stopVoice();
    setMicButton(false);
    showStatus(`Couldn't start the microphone: ${err.message}`, "error");
  }
}

micBtn.addEventListener("click", () => setTalking(!state.talking));

// Mic settings that need a fresh microphone stream.
function restartTalking() {
  if (state.talking) setTalking(true);
}

// ---------- Loopback test (ear) ----------

// Plays the converted voice on the default speakers too, so you can hear yourself.
const listenBtn = document.getElementById("listen-btn");

listenBtn.addEventListener("click", () => {
  state.listening = !state.listening;
  listenBtn.setAttribute("aria-pressed", String(state.listening));
  listenBtn.setAttribute("aria-label", state.listening ? "Stop hearing yourself" : "Hear yourself");
  setTip(listenBtn, state.listening ? "Stop hearing yourself" : "Hear yourself: play your changed voice on your speakers");
  audio.setListening(state.listening);
});

// ---------- Audio file (music note) ----------

// Plays a .wav or .mp3 through the selected voice on the default speakers, to hear what the
// voice sounds like. Only the converted audio is played, never the original.
const fileBtn = document.getElementById("file-btn");
const fileInput = document.getElementById("file-input");

function setFileButton(name) {
  state.playingFile = name;
  updateTrayStatus();
  fileBtn.setAttribute("aria-pressed", String(!!name));
  fileBtn.setAttribute("aria-label", name ? "Stop playing the file" : "Play an audio file in this voice");
  setTip(fileBtn, name ? `Stop playing "${name}"` : "Try this voice on an audio file (.wav or .mp3)");
}

function stopFile() {
  audio.stopVoice();
  setFileButton(null);
  showDelay(); // back to the estimate
  if (state.server === "ready") showReadyStatus();
}

async function playFile(file) {
  if (state.talking) setMicButton(false); // the file takes over from the mic
  setFileButton(file.name);
  showStatus(`Converting "${file.name}"…`);
  try {
    await audio.startVoice({ ...state, file: await file.arrayBuffer(), onError: onAudioError, onEnded: stopFile, onTiming: recordConversionTime, onLatency: showDelay });
    showReadyStatus();
  } catch (err) {
    stopFile();
    showStatus(`Couldn't play "${file.name}": ${err.message}`, "error");
  }
}

fileBtn.addEventListener("click", () => {
  if (state.playingFile) return stopFile();
  if (!server) return showStatus("Open VoicePlay in the desktop app to use the voice changer.", "warn");
  if (state.server !== "ready") return showStatus("The voice server isn't ready yet.", "warn");
  if (!hasModel(currentVoice())) return showReadyStatus();
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileInput.value = ""; // so picking the same file again still counts as a change
  if (file) playFile(file);
});

// ---------- Pop-ups ----------

// Each button toggles its pop-up; clicking elsewhere or pressing Escape closes it.
const POPOVERS = [
  { button: document.getElementById("tune-btn"), popover: document.getElementById("tune-pop") },
  { button: document.getElementById("settings-btn"), popover: document.getElementById("settings-pop"), onOpen: () => refreshDevices() },
  { button: document.getElementById("delay-info-btn"), popover: document.getElementById("delay-pop"), onOpen: () => showSpeed() },
];

function setPopover(entry, open) {
  entry.popover.hidden = !open;
  entry.button.setAttribute("aria-expanded", String(open));
  if (open) entry.onOpen?.();
}

for (const entry of POPOVERS) {
  entry.button.addEventListener("click", () => {
    const open = entry.popover.hidden;
    POPOVERS.forEach((other) => setPopover(other, false));
    setPopover(entry, open);
  });
}

document.addEventListener("click", (e) => {
  for (const entry of POPOVERS) {
    if (!entry.popover.hidden && !entry.popover.contains(e.target) && !entry.button.contains(e.target)) {
      setPopover(entry, false);
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = POPOVERS.find((entry) => !entry.popover.hidden);
  if (open) {
    setPopover(open, false);
    open.button.focus();
  }
});

// ---------- Audio settings ----------

const inputSelect = document.getElementById("input-device");
const outputSelect = document.getElementById("output-device");

function fillSelect(select, options, selected) {
  select.innerHTML = options
    .map((o) => `<option value="${o.value}"${o.value === selected ? " selected" : ""}>${o.label}</option>`)
    .join("");
}

// Lists the computer's microphones and speakers. Browsers hide device details until the
// page has been allowed to use the microphone (devices then come back without IDs), so
// unnamed devices get numbered and hidden ones fall back to the system default.
async function refreshDevices() {
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (err) {
    console.warn("Couldn't list audio devices:", err);
  }
  const list = (kind, noun) => {
    const ofKind = devices.filter((d) => d.kind === kind);
    const found = ofKind
      .filter((d) => d.deviceId && d.deviceId !== "communications")
      .map((d, i) => ({ value: d.deviceId, label: d.label || `${noun} ${i + 1}` }));
    if (found.length) {
      // A saved device that's been unplugged falls back to the system default.
      const key = kind === "audioinput" ? "inputDevice" : "outputDevice";
      if (state[key] !== "default" && !found.some((d) => d.value === state[key])) state[key] = "default";
      return found;
    }
    const label = ofKind.length ? `Default ${noun.toLowerCase()}` : `No ${noun.toLowerCase()} found`;
    return [{ value: "default", label }];
  };
  fillSelect(inputSelect, list("audioinput", "Microphone"), state.inputDevice);
  fillSelect(outputSelect, list("audiooutput", "Speaker"), state.outputDevice);
}

inputSelect.addEventListener("change", () => {
  state.inputDevice = inputSelect.value;
  savePrefs();
  restartTalking();
});
outputSelect.addEventListener("change", () => {
  state.outputDevice = outputSelect.value;
  savePrefs();
  audio.setOutputDevice(state.outputDevice).catch((err) => showStatus(`Couldn't switch output: ${err.message}`, "error"));
});
navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);

// A control can appear in more than one pop-up (the Microphone settings are in both
// Settings and Voice adjustments): the copy with the id is the original, the others carry
// data-mirror="<id>". Every copy shows the same value.
const controlCopies = (id) => document.querySelectorAll(`#${id}, [data-mirror="${id}"]`);

// `onInput` runs while dragging; `onCommit` once the slider is let go.
function bindSlider(id, key, format, { onInput, onCommit } = {}) {
  const show = () => {
    controlCopies(id).forEach((slider) => (slider.value = state[key]));
    controlCopies(`${id}-value`).forEach((readout) => (readout.textContent = format(state[key])));
  };
  show();
  for (const slider of controlCopies(id)) {
    slider.addEventListener("input", () => {
      state[key] = Number(slider.value);
      show();
      onInput?.(state[key]);
    });
    slider.addEventListener("change", () => {
      savePrefs();
      onCommit?.(state[key]);
    });
  }
  return show;
}

const formatPitch = (v) => (v > 0 ? `+${v}` : String(v));

bindSlider("volume", "volume", (v) => `${v}%`, { onInput: (v) => audio.setVolume(v) });

// Pitch belongs to the selected voice: the slider shows that voice's pitch, and moving it
// saves a value for that voice only.
const pitchSlider = document.getElementById("pitch");
const pitchReadout = document.getElementById("pitch-value");

function sendPitch() {
  if (state.server !== "ready") return;
  server.update("tran", voicePitch(currentVoice())).catch((err) => showStatus(`Couldn't set pitch: ${err.message}`, "error"));
}

// Shows the selected voice's pitch on the slider.
function showVoicePitch() {
  const voice = currentVoice();
  pitchSlider.value = voicePitch(voice);
  pitchReadout.textContent = formatPitch(voicePitch(voice));
  document.getElementById("pitch-voice").textContent = `(${voice.name})`;
}

pitchSlider.addEventListener("input", () => (pitchReadout.textContent = formatPitch(Number(pitchSlider.value))));
pitchSlider.addEventListener("change", () => {
  state.pitches[state.selected] = Number(pitchSlider.value);
  savePrefs();
  sendPitch();
});

showVoicePitch();

// ---------- Effects ----------

// Each effect is a switch, with its sliders shown while it's on. Changes apply straight
// away, including while talking or playing a file.
const effectsList = document.getElementById("effects-list");

effectsList.innerHTML = EFFECTS.map((fx) => {
  const settings = state.effects[fx.id];
  const sliders = fx.params.map((p) => `
      <label class="field">
        <span class="field-label">${p.label} <output data-readout="${p.key}">${p.format(settings[p.key])}</output></span>
        <input type="range" data-param="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${settings[p.key]}">
      </label>`).join("");
  return `
    <div class="effect" data-effect="${fx.id}">
      <div class="field field-row" data-tip="${fx.tip}">
        <span class="field-label" id="fx-${fx.id}-label">${fx.name}</span>
        <button class="switch" role="switch" aria-checked="${settings.on}" aria-labelledby="fx-${fx.id}-label"></button>
      </div>
      <div class="effect-params"${settings.on ? "" : " hidden"}>${sliders}</div>
    </div>`;
}).join("");

effectsList.addEventListener("click", (e) => {
  const button = e.target.closest(".switch");
  if (!button) return;
  const effect = button.closest(".effect");
  const settings = state.effects[effect.dataset.effect];
  settings.on = !settings.on;
  button.setAttribute("aria-checked", String(settings.on));
  effect.querySelector(".effect-params").hidden = !settings.on;
  audio.setEffects(state.effects);
  savePrefs();
});

effectsList.addEventListener("input", (e) => {
  const slider = e.target.closest("[data-param]");
  if (!slider) return;
  const effect = slider.closest(".effect");
  const fx = EFFECTS.find((f) => f.id === effect.dataset.effect);
  const param = fx.params.find((p) => p.key === slider.dataset.param);
  state.effects[fx.id][param.key] = Number(slider.value);
  effect.querySelector(`[data-readout="${param.key}"]`).textContent = param.format(Number(slider.value));
  audio.setEffects(state.effects);
});

effectsList.addEventListener("change", (e) => {
  if (e.target.closest("[data-param]")) savePrefs();
});

// ---------- App settings ----------

// Reduce noise has a copy in Voice adjustments too (see controlCopies).
const showNoise = () => controlCopies("noise").forEach((s) => s.setAttribute("aria-checked", String(state.reduceNoise)));
showNoise();
for (const noiseSwitch of controlCopies("noise")) {
  noiseSwitch.addEventListener("click", () => {
    state.reduceNoise = !state.reduceNoise;
    showNoise();
    savePrefs();
    restartTalking();
  });
}

// Filled from the server's GPU list once connected; -1 means CPU.
// Sensitivity is the server's noise gate (silentThreshold, Okada's "S.Thresh"): input
// quieter than the threshold isn't converted. Okada's slider runs 0 to 0.001; here it's
// inverted so that higher sensitivity picks up quieter sounds (100% = no gate).
const MAX_THRESHOLD = 0.001;
const sensitivityToThreshold = (percent) => (MAX_THRESHOLD * (100 - percent)) / 100;
const thresholdToSensitivity = (threshold) => Math.round(100 - (Math.min(threshold, MAX_THRESHOLD) / MAX_THRESHOLD) * 100);

function sendSensitivity() {
  if (state.server !== "ready") return;
  server
    .update("silentThreshold", sensitivityToThreshold(state.sensitivity))
    .catch((err) => showStatus(`Couldn't set sensitivity: ${err.message}`, "error"));
}

const showSensitivity = bindSlider("sensitivity", "sensitivity", (v) => `${v}%`, { onCommit: sendSensitivity });

function setSensitivitySlider(percent) {
  state.sensitivity = percent;
  showSensitivity();
}

bindSlider("input-gain", "inputGain", (v) => `${v}%`, { onInput: (v) => audio.setInputGain(v) });

// Sends a server setting once a slider is let go.
const sendSetting = (key, toServer) => (v) => {
  if (state.server !== "ready") return;
  server.update(key, toServer(v)).catch((err) => showStatus(`Couldn't change ${key}: ${err.message}`, "error"));
};

bindSlider("index-ratio", "indexRatio", (v) => `${v}%`, { onCommit: sendSetting("indexRatio", (v) => v / 100) });
bindSlider("protect", "protect", (v) => `${v}%`, { onCommit: sendSetting("protect", protectToServer) });

const gpuSelect = document.getElementById("gpu");

function fillGpus(gpus) {
  const options = [...gpus.map((g) => ({ value: String(g.id), label: g.name })), { value: "-1", label: "CPU" }];
  if (!options.some((o) => o.value === String(state.gpu))) state.gpu = Number(options[0].value);
  fillSelect(gpuSelect, options, String(state.gpu));
}

fillGpus([{ id: 0, name: "GPU 0" }]);
gpuSelect.addEventListener("change", () => {
  state.gpu = Number(gpuSelect.value);
  savePrefs();
  if (state.server === "ready") server.update("gpu", state.gpu).then(measureDelay);
});

const chunkSelect = document.getElementById("chunk");
fillSelect(
  chunkSelect,
  CHUNK_SIZES.map((n) => ({ value: String(n), label: `${n} (${Math.round((n * 1000) / 48000)} ms)` })),
  String(state.chunk),
);
chunkSelect.addEventListener("change", () => {
  state.chunk = Number(chunkSelect.value);
  savePrefs();
  audio.setChunk(state.chunk);
  measureDelay();
  showSpeed();
});

// Server-side quality settings: Extra and Crossfade are dropdowns, High quality and Fast
// Extra are switches. Each sends its value to the server as soon as it changes.
const sendQuality = (key) => {
  if (state.server !== "ready") return;
  server
    .update(key, qualitySettings()[key])
    .then(measureDelay) // these all change how long a conversion takes
    .catch((err) => showStatus(`Couldn't change ${key}: ${err.message}`, "error"));
};

const samplesLabel = (n) => `${n} (${Math.round((n * 1000) / 48000)} ms)`;

function bindSampleSelect(id, key, sizes, serverKey) {
  const select = document.getElementById(id);
  fillSelect(select, sizes.map((n) => ({ value: String(n), label: samplesLabel(n) })), String(state[key]));
  select.addEventListener("change", () => {
    state[key] = Number(select.value);
    savePrefs();
    sendQuality(serverKey);
    showSpeed();
  });
}

// Okada's EXTRA options, and crossfade sizes around the server's default of 4096.
bindSampleSelect("extra", "extra", [4096, 8192, 16384, 32768, 65536, 131072], "extraConvertSize");
bindSampleSelect("crossfade", "crossfade", [1024, 2048, 4096, 8192, 16384], "crossFadeOverlapSize");

function bindSwitch(id, key, serverKey) {
  const button = document.getElementById(id);
  button.setAttribute("aria-checked", String(state[key]));
  button.addEventListener("click", () => {
    state[key] = !state[key];
    button.setAttribute("aria-checked", String(state[key]));
    savePrefs();
    sendQuality(serverKey);
    showSpeed();
  });
}

bindSwitch("high-quality", "highQuality", "rvcQuality");
bindSwitch("track-pitch", "trackPitch", "silenceFront");

// "Report a problem…" opens the log folder (desktop app only).
const openLogsBtn = document.getElementById("open-logs");
openLogsBtn.hidden = !window.voiceplay;
openLogsBtn.addEventListener("click", () => window.voiceplay?.openLogFolder());

const f0Select = document.getElementById("f0-detector");
f0Select.value = state.f0Detector;
f0Select.addEventListener("change", () => {
  state.f0Detector = f0Select.value;
  savePrefs();
  sendQuality("f0Detector");
  showSpeed();
});

// ---------- Speed slider (in the "About delay" pop-up) ----------

// Five stops from fast to slow, each setting all the speed-related settings at once. Chunk
// size is most of the delay; slower stops also add context (Extra), smoother joins
// (Crossfade) and High quality; the two fastest use the fast pitch detector (FCPE, about a
// third less GPU time per chunk than RMVPE). Measured on an RTX 5080, every stop converts
// well within its chunk time (the slowest takes about 120 ms per 1 s chunk). The 2400 chunk
// is left out: it barely keeps up.
const SPEED_PRESETS = [
  { name: "Fastest", chunk: 4800, extra: 4096, crossfade: 1024, highQuality: false, trackPitch: false, f0Detector: "fcpe" },
  { name: "Fast", chunk: 9600, extra: 8192, crossfade: 2048, highQuality: false, trackPitch: false, f0Detector: "fcpe" },
  { name: "Balanced", chunk: 14400, extra: 16384, crossfade: 4096, highQuality: false, trackPitch: false, f0Detector: "rmvpe_onnx" },
  { name: "Smooth", chunk: 24000, extra: 32768, crossfade: 4096, highQuality: true, trackPitch: false, f0Detector: "rmvpe_onnx" },
  { name: "Best quality", chunk: 48000, extra: 65536, crossfade: 8192, highQuality: true, trackPitch: true, f0Detector: "rmvpe_onnx" },
];
const SPEED_KEYS = ["chunk", "extra", "crossfade", "highQuality", "trackPitch", "f0Detector"];

const speedSlider = document.getElementById("speed");
const speedValue = document.getElementById("speed-value");
const speedDots = [...document.querySelectorAll("#speed-dots span")];

// The stop matching the current settings, or -1 if they've been changed by hand.
const currentSpeed = () => SPEED_PRESETS.findIndex((p) => SPEED_KEYS.every((k) => p[k] === state[k]));

// `custom`: the settings were changed by hand, so the slider turns yellow and a note warns
// that moving it will replace those changes.
function showSpeedStop(i, custom = false) {
  speedSlider.value = i;
  speedValue.textContent = custom ? "Custom" : SPEED_PRESETS[i].name;
  speedDots.forEach((dot, d) => (dot.dataset.active = String(!custom && d === i)));
  document.getElementById("speed-field").dataset.custom = String(custom);
  document.getElementById("speed-custom-note").hidden = !custom;
}

// Shows where the current settings sit; hand-picked settings show as "Custom", with the
// slider at the stop with the nearest chunk size.
function showSpeed() {
  const i = currentSpeed();
  if (i >= 0) return showSpeedStop(i);
  const nearest = SPEED_PRESETS.reduce((best, p, j) => (Math.abs(p.chunk - state.chunk) < Math.abs(SPEED_PRESETS[best].chunk - state.chunk) ? j : best), 0);
  showSpeedStop(nearest, true);
}

async function applySpeed(i) {
  const preset = SPEED_PRESETS[i];
  for (const k of SPEED_KEYS) state[k] = preset[k];
  // Keep the Settings pop-up's controls in step.
  chunkSelect.value = String(state.chunk);
  document.getElementById("extra").value = String(state.extra);
  document.getElementById("crossfade").value = String(state.crossfade);
  document.getElementById("high-quality").setAttribute("aria-checked", String(state.highQuality));
  document.getElementById("track-pitch").setAttribute("aria-checked", String(state.trackPitch));
  f0Select.value = state.f0Detector;
  savePrefs();
  audio.setChunk(state.chunk);
  showSpeed();
  if (state.server !== "ready") return measureDelay();
  try {
    for (const [key, val] of Object.entries(qualitySettings())) await server.update(key, val);
  } catch (err) {
    showStatus(`Couldn't change the speed settings: ${err.message}`, "error");
  }
  measureDelay();
}

speedSlider.addEventListener("input", () => showSpeedStop(Number(speedSlider.value)));
speedSlider.addEventListener("change", () => applySpeed(Number(speedSlider.value)));
showSpeed();

// ---------- Estimated delay ----------

// Delay = time from recording a chunk to starting to play it (waiting for the chunk to fill
// + converting it, measured by the audio pipeline while it runs) + how far the server shifts
// its output back (the crossfade plus a 12 ms alignment search) + the mic driver's and sound
// card's buffers. When nothing is running, the first part is estimated from the chunk size
// and a timed test conversion, re-run whenever a setting that affects it changes.
// Not included: anything before VoicePlay gets the audio (e.g. another voice app's virtual
// mic) or after it leaves (e.g. the virtual cable, the game or chat app).
const delayEl = document.getElementById("delay");
const delayRow = document.getElementById("delay-row"); // the text and its "i" button
const DEFAULT_IO_LATENCY_S = 0.06; // mic + sound card buffers, until audio is running and can be asked
const SERVER_ALIGN_S = 0.012; // the server's alignment search (sola_search_frame)
let convertMs = null;
let probeTimer = null;

function showDelay() {
  if (convertMs === null || state.server !== "ready") {
    delayRow.hidden = true;
    return;
  }
  const measured = audio.stats()?.latency; // only while talking or playing a file
  const pipeline = measured ?? state.chunk / 48000 + convertMs / 1000;
  const seconds = pipeline + state.crossfade / 48000 + SERVER_ALIGN_S + (audio.ioLatency() ?? DEFAULT_IO_LATENCY_S);
  delayEl.textContent = `Your estimated delay: ${seconds < 1 ? seconds.toFixed(2) : seconds.toFixed(1)}s`;
  delayRow.hidden = false;
}

// Live timings, smoothed so the number doesn't jump around.
function recordConversionTime(ms) {
  convertMs = convertMs === null ? ms : convertMs * 0.7 + ms * 0.3;
  showDelay();
}

function measureDelay() {
  showDelay(); // the chunk part is known straight away
  clearTimeout(probeTimer);
  probeTimer = setTimeout(async () => {
    // While audio is running the live timings are better, and a test would disturb it.
    if (state.server !== "ready" || state.talking || state.playingFile) return;
    const noise = new Int16Array(state.chunk).map(() => (Math.random() - 0.5) * 2000);
    const started = performance.now();
    try {
      await server.convert(noise.buffer);
      convertMs = performance.now() - started;
    } catch {
      // Keep the last estimate.
    }
    showDelay();
  }, 400);
}

// ---------- Voice server ----------

// Once the server is up: learn its GPUs and which voices have models, then apply our settings.
async function onServerReady() {
  showStatus("");
  startupProgress.phase("connecting");
  try {
    const info = await server.info();
    state.filledSlots = new Set(info.modelSlots.filter((s) => s.voiceChangerType).map((s) => s.slotIndex));
    fillGpus(info.gpus);
    renderVoices();
    logEvent("info", "server", "connected", {
      gpus: info.gpus.map((g) => g.name),
      python: info.python?.split(" ")[0],
      voicesWithoutModel: VOICES.filter((v) => !hasModel(v)).map((v) => v.name),
    });
    await server.update("gpu", state.gpu);
    await applyVoice();
    if ("sensitivity" in savedPrefs) {
      sendSensitivity();
    } else {
      // Never set here before: show the server's own noise gate (known once a model is loaded).
      const loaded = await server.info();
      if (typeof loaded.silentThreshold === "number") setSensitivitySlider(thresholdToSensitivity(loaded.silentThreshold));
      savePrefs();
    }
    startupProgress.done();
    setAppReady(true);
  } catch (err) {
    startupProgress.fail();
    showStatus(`Couldn't talk to the voice server: ${err.message}`, "error");
  }
}

function onServerStatus(status) {
  // The startup status query and the first status event can both report "ready".
  if (status === "ready" && state.server === "ready") return;
  state.server = status;
  if (status === "ready") return onServerReady();
  setAppReady(false);
  showDelay(); // hides it until the server is back
  if (state.talking) setTalking(false);
  if (state.playingFile) stopFile();
  if (status === "starting") {
    showStatus("");
    startupProgress.phase("starting");
  } else {
    startupProgress.fail();
  }
  if (status === "missing") showStatus("Voice server not found. Set up server\\.venv, or start the server yourself.", "error");
  if (status === "stopped") showStatus("The voice server stopped.", "error");
}

// ---------- Ready state ----------

// The voices and mic bar are grayed out and inert until the server is up and a voice loaded.
const appEl = document.querySelector(".app");

function setAppReady(ready) {
  appEl.dataset.ready = ready;
  for (const el of [document.getElementById("voices"), document.querySelector(".talk-bar")]) el.inert = !ready;
}

setAppReady(false);

// ---------- Startup progress bar ----------

// The server doesn't report how far along it is, so the bar eases towards each phase's
// ceiling (fast at first, then slowing down) and jumps to 100% once the first voice is
// loaded. `tau` is roughly how long that phase usually takes, in seconds.
const STARTUP_PHASES = {
  starting: { label: "Starting the voice server…", from: 0, to: 80, tau: 25 },
  connecting: { label: "Loading your voice…", from: 80, to: 97, tau: 6 },
};

const startupProgress = (() => {
  const root = document.getElementById("startup");
  const fill = root.querySelector(".startup-fill");
  const label = root.querySelector(".startup-label");
  const bar = root.querySelector('[role="progressbar"]');
  let timer = null;
  let value = 0;

  const render = () => {
    fill.style.width = `${value}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(value)));
  };

  function phase(name) {
    const p = STARTUP_PHASES[name];
    const start = Math.max(value, p.from);
    const began = Date.now();
    clearInterval(timer);
    root.hidden = false;
    root.dataset.state = "running";
    label.textContent = p.label;
    timer = setInterval(() => {
      const t = (Date.now() - began) / 1000;
      value = start + (p.to - start) * (1 - Math.exp(-t / p.tau));
      render();
    }, 200);
  }

  function done() {
    clearInterval(timer);
    value = 100;
    render();
    root.dataset.state = "done";
    setTimeout(() => {
      if (root.dataset.state === "done") root.hidden = true;
    }, 600);
  }

  function fail() {
    clearInterval(timer);
    value = 0;
    render();
    root.hidden = true;
  }

  return { phase, done, fail };
})();

// ---------- Onboarding ----------

// First run only: ask whether the user's natural voice is deeper or higher. That sets
// every voice's starting pitch (see RANGE_PITCH).
function runOnboarding() {
  if (state.voiceRange) return;
  const dialog = document.getElementById("onboarding");
  dialog.addEventListener("cancel", (e) => e.preventDefault()); // needs an answer
  dialog.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-range]");
    if (!choice) return;
    state.voiceRange = choice.dataset.range;
    savePrefs();
    showVoicePitch();
    sendPitch();
    dialog.close();
  });
  dialog.showModal();
}

// ---------- Desktop window ----------

if (window.voiceplay) {
  document.documentElement.classList.add("desktop");
  document.getElementById("win-min").addEventListener("click", () => window.voiceplay.minimize());
  document.getElementById("win-max").addEventListener("click", () => window.voiceplay.toggleMaximize());
  document.getElementById("win-close").addEventListener("click", () => window.voiceplay.close());

  // The top bar drags the window (see electron/main.js); double-clicking it maximizes, as
  // with a normal title bar. Pointer capture makes sure we hear about the release even if
  // it happens outside the window.
  for (const area of [document.querySelector(".drag-strip"), document.querySelector(".app-header")]) {
    area.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      area.setPointerCapture(e.pointerId);
      window.voiceplay.dragStart();
    });
    area.addEventListener("lostpointercapture", () => window.voiceplay.dragEnd());
    area.addEventListener("dblclick", (e) => {
      if (!e.target.closest("button")) window.voiceplay.toggleMaximize();
    });
  }
}

renderVoices();
runOnboarding();

if (server) {
  server.onStatus(onServerStatus);
  server.status().then(onServerStatus);
} else {
  showStatus("Open VoicePlay in the desktop app to use the voice changer.", "warn");
}
