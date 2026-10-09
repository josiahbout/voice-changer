// Voices shown in the picker. Portraits live in avatars/.
const VOICES = [
  { id: "sweetheart", name: "Mr. Sweetheart", image: "avatars/sweetheart.png" },
  { id: "bro", name: "Mr. Bro", image: "avatars/bro.png" },
  { id: "gentleman", name: "Mr. Gentleman", image: "avatars/gentleman.png" },
  { id: "rockstar", name: "Mr. Rockstar", image: "avatars/rockstar.png" },
  { id: "nerd", name: "Mr. Nerd", image: "avatars/nerd.png" },
  { id: "veteran", name: "Mr. Veteran", image: "avatars/veteran.png" },
];

// Chunk sizes offered in settings. One chunk is 128 samples at 48 kHz, matching the
// voice-changer server's serverReadChunkSize.
const CHUNK_SIZES = [32, 64, 96, 128, 192, 256, 384, 512];

// TODO: fill from the server's /info "gpus" list once connected; -1 means CPU.
const GPUS = [
  { id: 0, name: "GPU 0" },
  { id: -1, name: "CPU" },
];

// Settings only change the UI for now; none of them reach the server yet.
const state = {
  selected: "gentleman",
  talking: false,
  listening: false, // loopback test: hear your own converted voice
  inputDevice: "default",
  outputDevice: "default",
  volume: 100, // percent
  pitch: 0, // semitones, the server's "tran"
  reduceNoise: false,
  gpu: 0,
  chunk: 256, // the original client's default
};

// ---------- Voice cards ----------

function renderVoices() {
  const root = document.getElementById("voices");
  root.innerHTML = VOICES.map((v) => `
    <div class="voice" role="radio" tabindex="0" data-id="${v.id}" aria-checked="${v.id === state.selected}">
      <div class="avatar"><img src="${v.image}" alt=""></div>
      <div class="voice-name">${v.name}</div>
    </div>`).join("");
}

document.getElementById("voices").addEventListener("click", (e) => {
  const card = e.target.closest(".voice");
  if (card) {
    state.selected = card.dataset.id;
    renderVoices();
  }
});

document.getElementById("voices").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("voice")) {
    e.preventDefault();
    state.selected = e.target.dataset.id;
    renderVoices();
    document.querySelector(`.voice[data-id="${state.selected}"]`).focus();
  }
});

// ---------- Mic ----------

// Visual on/off toggle only for now.
// TODO: open the microphone and stream audio to the voice-changer server when on.
const micBtn = document.getElementById("mic-btn");

function setTalking(on) {
  state.talking = on;
  micBtn.setAttribute("aria-pressed", String(on));
  micBtn.setAttribute("aria-label", on ? "Stop talking" : "Tap to talk");
}

micBtn.addEventListener("click", () => setTalking(!state.talking));

// ---------- Loopback test (ear) ----------

// TODO: play the converted voice back through the user's speakers when on.
const listenBtn = document.getElementById("listen-btn");

listenBtn.addEventListener("click", () => {
  state.listening = !state.listening;
  listenBtn.setAttribute("aria-pressed", String(state.listening));
  listenBtn.setAttribute("aria-label", state.listening ? "Stop hearing yourself" : "Hear yourself");
});

// ---------- Pop-ups ----------

// Each button toggles its pop-up; clicking elsewhere or pressing Escape closes it.
const POPOVERS = [
  { button: document.getElementById("tune-btn"), popover: document.getElementById("tune-pop"), onOpen: () => refreshDevices() },
  { button: document.getElementById("settings-btn"), popover: document.getElementById("settings-pop") },
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
    if (found.length) return found;
    const label = ofKind.length ? `Default ${noun.toLowerCase()}` : `No ${noun.toLowerCase()} found`;
    return [{ value: "default", label }];
  };
  fillSelect(inputSelect, list("audioinput", "Microphone"), state.inputDevice);
  fillSelect(outputSelect, list("audiooutput", "Speaker"), state.outputDevice);
}

inputSelect.addEventListener("change", () => (state.inputDevice = inputSelect.value));
outputSelect.addEventListener("change", () => (state.outputDevice = outputSelect.value));
navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);

function bindSlider(id, key, format) {
  const slider = document.getElementById(id);
  const readout = document.getElementById(`${id}-value`);
  slider.addEventListener("input", () => {
    state[key] = Number(slider.value);
    readout.textContent = format(state[key]);
  });
}

bindSlider("volume", "volume", (v) => `${v}%`);
bindSlider("pitch", "pitch", (v) => (v > 0 ? `+${v}` : String(v)));

// ---------- App settings ----------

const noiseSwitch = document.getElementById("noise");
noiseSwitch.addEventListener("click", () => {
  state.reduceNoise = !state.reduceNoise;
  noiseSwitch.setAttribute("aria-checked", String(state.reduceNoise));
});

const gpuSelect = document.getElementById("gpu");
fillSelect(gpuSelect, GPUS.map((g) => ({ value: String(g.id), label: g.name })), String(state.gpu));
gpuSelect.addEventListener("change", () => (state.gpu = Number(gpuSelect.value)));

const chunkSelect = document.getElementById("chunk");
fillSelect(
  chunkSelect,
  CHUNK_SIZES.map((n) => ({ value: String(n), label: `${n} (${Math.round((n * 128 * 1000) / 48000)} ms)` })),
  String(state.chunk),
);
chunkSelect.addEventListener("change", () => (state.chunk = Number(chunkSelect.value)));

// ---------- Desktop window ----------

// window.voiceplay only exists inside the Electron app (see electron/preload.js).
if (window.voiceplay) {
  document.documentElement.classList.add("desktop");
  document.getElementById("win-min").addEventListener("click", () => window.voiceplay.minimize());
  document.getElementById("win-max").addEventListener("click", () => window.voiceplay.toggleMaximize());
  document.getElementById("win-close").addEventListener("click", () => window.voiceplay.close());
}

renderVoices();
