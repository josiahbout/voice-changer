// Voices shown in the picker. Portraits live in avatars/.
const VOICES = [
  { id: "sweetheart", name: "Mr. Sweetheart", image: "avatars/sweetheart.png" },
  { id: "bro", name: "Mr. Bro", image: "avatars/bro.png" },
  { id: "gentleman", name: "Mr. Gentleman", image: "avatars/gentleman.png" },
  { id: "rockstar", name: "Mr. Rockstar", image: "avatars/rockstar.png" },
  { id: "nerd", name: "Mr. Nerd", image: "avatars/nerd.png" },
  { id: "veteran", name: "Mr. Veteran", image: "avatars/veteran.png" },
];

const state = {
  selected: "gentleman",
  talking: false,
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

// ---------- Desktop window ----------

// window.voiceplay only exists inside the Electron app (see electron/preload.js).
if (window.voiceplay) {
  document.documentElement.classList.add("desktop");
  document.getElementById("win-min").addEventListener("click", () => window.voiceplay.minimize());
  document.getElementById("win-max").addEventListener("click", () => window.voiceplay.toggleMaximize());
  document.getElementById("win-close").addEventListener("click", () => window.voiceplay.close());
}

renderVoices();
