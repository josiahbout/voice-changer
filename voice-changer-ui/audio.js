// Audio pipeline: microphone (or an audio file) -> voice-changer server -> output device.
// An AudioWorklet cuts the input into chunks; each chunk goes to the server as 48 kHz Int16
// PCM (through window.voiceplay.server, see electron/server.js) and the converted audio is
// queued back into the same worklet for playback.

const SAMPLE_RATE = 48000; // the server's default inputSampleRate / outputSampleRate

// Runs on the audio thread. Collects input into chunks and plays queued audio.
// Messages in: "chunk" (new size), "play" (converted audio), "flush" (input has ended:
// send what's buffered and say "end"), "notify-idle" (say "idle" once playback runs dry).
// Messages out: "chunk" (input to convert, with the audio frame its first sample was
// recorded at), "latency" (frames between recording a chunk and starting to play it),
// "end", "idle".
const WORKLET_SOURCE = `
class VoicePlayIO extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.setChunk(options.processorOptions.chunkSamples);
    this.maxQueued = options.processorOptions.maxQueued;
    this.queue = []; // { samples, startFrame }
    this.head = null;
    this.pos = 0;
    this.notifyIdle = false;
    this.port.onmessage = (e) => {
      if (e.data.type === "chunk") this.setChunk(e.data.chunkSamples);
      if (e.data.type === "play") {
        this.queue.push({ samples: e.data.samples, startFrame: e.data.startFrame });
        // Drop the oldest audio if we fall behind, so latency can't build up.
        while (this.queue.length > this.maxQueued) this.queue.shift();
      }
      if (e.data.type === "flush") {
        // The rest of the buffer is already zeros, so the last chunk is padded with silence.
        if (this.fill > 0) this.sendChunk();
        this.port.postMessage({ type: "end" });
      }
      if (e.data.type === "notify-idle") this.notifyIdle = true;
    };
  }

  setChunk(n) {
    this.chunk = n;
    this.buf = new Float32Array(n);
    this.fill = 0;
  }

  sendChunk() {
    this.port.postMessage({ type: "chunk", samples: this.buf, startFrame: this.startFrame }, [this.buf.buffer]);
    this.buf = new Float32Array(this.chunk);
    this.fill = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0][0];
    if (input) {
      for (let i = 0; i < input.length; ) {
        if (this.fill === 0) this.startFrame = currentFrame + i;
        const n = Math.min(input.length - i, this.chunk - this.fill);
        this.buf.set(input.subarray(i, i + n), this.fill);
        this.fill += n;
        i += n;
        if (this.fill === this.chunk) this.sendChunk();
      }
    }
    const out = outputs[0];
    for (let i = 0; i < out[0].length; i++) {
      if (!this.head || this.pos >= this.head.samples.length) {
        this.head = this.queue.shift() || null;
        this.pos = 0;
        if (this.head) this.port.postMessage({ type: "latency", frames: currentFrame + i - this.head.startFrame });
      }
      out[0][i] = this.head ? this.head.samples[this.pos++] : 0;
    }
    for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    if (this.notifyIdle && !this.head && !this.queue.length) {
      this.notifyIdle = false;
      this.port.postMessage({ type: "idle" });
    }
    return true;
  }
}
registerProcessor("voiceplay-io", VoicePlayIO);
`;

const toInt16 = (f32) => {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return i16;
};

const toFloat32 = (buffer) => {
  const i16 = new Int16Array(buffer);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
  return f32;
};

// "default" in the device pickers means the system default, which setSinkId calls "".
const sinkId = (deviceId) => (deviceId === "default" ? "" : deviceId);

// ---------- Effects ----------

// Effects run on the converted voice, in VoicePlay (no server work, no extra delay). Every
// effect is always wired in; switching one on or off only fades between its "dry" path
// (sound passes untouched) and its "wet" path, so settings can change while you talk.
// Settings shape: see EFFECTS in app.js, e.g. { echo: { on: true, time: 300, ... }, ... }.

// Soft clipping; higher `amount` distorts more. An odd length puts a point exactly at
// zero, so silence stays silent (an even length adds a small constant offset).
const distortionCurve = (amount) => {
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
};

// A room's echo pattern: decaying noise, `seconds` long.
function reverbImpulse(ctx, seconds) {
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

// Wraps an effect's wet path in a dry/wet mix.
function stage(ctx, wet) {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx);
  const wetGain = new GainNode(ctx, { gain: 0 });
  input.connect(dry).connect(output);
  input.connect(wet.input);
  wet.output.connect(wetGain).connect(output);
  const glide = (param, v) => param.setTargetAtTime(v, ctx.currentTime, 0.02); // no clicks
  return { input, output, mix: (dryLevel, wetLevel) => (glide(dry.gain, dryLevel), glide(wetGain.gain, wetLevel)) };
}

function createEffects(ctx) {
  const sources = []; // oscillators and noise that run for as long as the pipeline does
  const stages = {};
  let reverbSize = null;

  // Bass & treble: shelving filters.
  const bass = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 250 });
  const treble = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 3500 });
  bass.connect(treble);
  stages.eq = stage(ctx, { input: bass, output: treble });

  // Telephone: the phone-line band (about 300-3400 Hz), cut steeply with two filters on
  // each side, plus a little crunch. "Muffle" narrows the band and adds more crunch.
  const phoneLow1 = new BiquadFilterNode(ctx, { type: "highpass", Q: 0.7 });
  const phoneLow2 = new BiquadFilterNode(ctx, { type: "highpass", Q: 0.7 });
  const phoneHigh1 = new BiquadFilterNode(ctx, { type: "lowpass", Q: 0.7 });
  const phoneHigh2 = new BiquadFilterNode(ctx, { type: "lowpass", Q: 0.7 });
  const phonePresence = new BiquadFilterNode(ctx, { type: "peaking", frequency: 1500, Q: 1, gain: 4 });
  const phoneCrunch = new WaveShaperNode(ctx);
  const phoneOut = new GainNode(ctx, { gain: 0.9 });
  phoneLow1.connect(phoneLow2).connect(phoneHigh1).connect(phoneHigh2).connect(phonePresence).connect(phoneCrunch).connect(phoneOut);
  stages.telephone = stage(ctx, { input: phoneLow1, output: phoneOut });

  // Megaphone: honky midrange, heavily driven.
  const megaIn = new BiquadFilterNode(ctx, { type: "highpass", frequency: 600 });
  const megaHonk = new BiquadFilterNode(ctx, { type: "peaking", frequency: 1800, Q: 1, gain: 8 });
  const megaDrive = new WaveShaperNode(ctx, { oversample: "2x" });
  const megaLow = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 4500 });
  const megaOut = new GainNode(ctx, { gain: 0.6 });
  megaIn.connect(megaHonk).connect(megaDrive).connect(megaLow).connect(megaOut);
  stages.megaphone = stage(ctx, { input: megaIn, output: megaOut });

  // Robot: ring modulation (the voice multiplied by a low tone).
  const ring = new GainNode(ctx, { gain: 0 });
  const ringTone = new OscillatorNode(ctx, { type: "sine", frequency: 60 });
  ringTone.connect(ring.gain);
  ringTone.start();
  sources.push(ringTone);
  stages.robot = stage(ctx, { input: ring, output: ring });

  // Echo: a delay feeding back into itself.
  const echoDelay = new DelayNode(ctx, { maxDelayTime: 2 });
  const echoFeedback = new GainNode(ctx);
  echoDelay.connect(echoFeedback).connect(echoDelay);
  stages.echo = stage(ctx, { input: echoDelay, output: echoDelay });

  // Reverb: the voice played through a generated room.
  const reverb = new ConvolverNode(ctx);
  stages.reverb = stage(ctx, { input: reverb, output: reverb });

  // Leveler: a compressor with make-up gain, so quiet and loud speech come out closer.
  const leveler = new DynamicsCompressorNode(ctx, { attack: 0.005, release: 0.15, knee: 6 });
  const levelerGain = new GainNode(ctx);
  leveler.connect(levelerGain);
  stages.leveler = stage(ctx, { input: leveler, output: levelerGain });

  const order = ["eq", "telephone", "megaphone", "robot", "echo", "reverb", "leveler"];
  for (let i = 1; i < order.length; i++) stages[order[i - 1]].output.connect(stages[order[i]].input);

  function set(fx) {
    const { eq, telephone, megaphone, robot, echo, reverb: rv, leveler: lv } = fx;
    bass.gain.value = eq.bass;
    treble.gain.value = eq.treble;
    stages.eq.mix(eq.on ? 0 : 1, eq.on ? 1 : 0);

    const muffle = telephone.muffle / 100;
    phoneLow1.frequency.value = phoneLow2.frequency.value = 300 + muffle * 300; // 300 -> 600 Hz
    phoneHigh1.frequency.value = phoneHigh2.frequency.value = 3400 - muffle * 1400; // 3400 -> 2000 Hz
    phoneCrunch.curve = distortionCurve(2 + muffle * 18);
    // The crunch boosts quiet sounds more as it gets stronger; turn the output down to match,
    // so the effect stays about as loud as the voice without it.
    phoneOut.gain.value = 0.49 - muffle * 0.21;
    stages.telephone.mix(telephone.on ? 0 : 1, telephone.on ? 1 : 0);

    megaDrive.curve = distortionCurve(5 + (megaphone.drive / 100) * 60);
    stages.megaphone.mix(megaphone.on ? 0 : 1, megaphone.on ? 1 : 0);

    ringTone.frequency.value = robot.tone;
    stages.robot.mix(robot.on ? 0 : 1, robot.on ? 1 : 0);

    echoDelay.delayTime.value = echo.time / 1000;
    echoFeedback.gain.value = echo.feedback / 100;
    stages.echo.mix(1, echo.on ? echo.mix / 100 : 0);

    if (rv.size !== reverbSize) {
      reverbSize = rv.size;
      reverb.buffer = reverbImpulse(ctx, rv.size);
    }
    stages.reverb.mix(1, rv.on ? rv.mix / 100 : 0);

    leveler.threshold.value = -10 - (lv.strength / 100) * 30;
    leveler.ratio.value = 3 + (lv.strength / 100) * 9;
    levelerGain.gain.value = 1 + (lv.strength / 100) * 1.5;
    stages.leveler.mix(lv.on ? 0 : 1, lv.on ? 1 : 0);
  }

  return { input: stages.eq.input, output: stages.leveler.output, set, stop: () => sources.forEach((s) => s.stop()) };
}

let run = null; // the running pipeline, or null when stopped

// options: { inputDevice, outputDevice, reduceNoise, chunk (samples), inputGain, volume, listening,
// effects, onError, onTiming (ms each conversion took), onLatency (seconds from recording a
// chunk to starting to play it) }
// plus, to convert an audio file instead of the mic: { file (ArrayBuffer of a .wav/.mp3), onEnded }.
// A file plays on the default speakers so you can hear it; only its converted voice is
// played, never the original.
async function startVoice(options) {
  stopVoice();
  const { server } = window.voiceplay;
  const fromFile = !!options.file;

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  await ctx.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);

  const io = new AudioWorkletNode(ctx, "voiceplay-io", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    // Mix stereo input (e.g. a music file) down to mono rather than using the left channel.
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    // A file never drops converted audio (see pump below).
    processorOptions: { chunkSamples: options.chunk, maxQueued: fromFile ? Infinity : 3 },
  });
  // inputGain: level going into the converter; gain: level of the converted voice.
  const inputGain = new GainNode(ctx, { gain: options.inputGain / 100 });
  inputGain.connect(io);
  const gain = new GainNode(ctx, { gain: options.volume / 100 });
  const effects = createEffects(ctx);
  effects.set(options.effects);
  io.connect(effects.input);
  effects.output.connect(gain).connect(ctx.destination);

  const stats = { sent: 0, played: 0, dropped: 0, errors: 0 }; // for diagnostics
  const self = { ctx, io, inputGain, gain, effects, stats, fromFile, stream: null, source: null, loopback: null, pending: [], busy: false, inputDone: false, stopped: false, onError: options.onError };
  run = self;

  if (fromFile) {
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(options.file);
    } catch {
      stopVoice();
      throw new Error("That file couldn't be read as audio.");
    }
    // The source feeds the converter only; it is never connected to the speakers.
    self.source = new AudioBufferSourceNode(ctx, { buffer });
    self.source.connect(inputGain);
    self.source.onended = () => io.port.postMessage({ type: "flush" });
    self.source.start();
  } else {
    self.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.inputDevice === "default" ? undefined : { exact: options.inputDevice },
        channelCount: 1,
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: options.reduceNoise,
      },
    });
    if (self.stopped) return self.stream.getTracks().forEach((t) => t.stop());
    ctx.createMediaStreamSource(self.stream).connect(inputGain);

    // Loopback test: the same converted voice, played on the system default speakers.
    self.loopback = new Audio();
    const loopbackDest = ctx.createMediaStreamDestination();
    gain.connect(loopbackDest);
    self.loopback.srcObject = loopbackDest.stream;
    self.loopback.muted = !options.listening;

    await setOutputDevice(options.outputDevice);
    await self.loopback.play();
  }

  // A file is done once its last chunk has been converted and played.
  const maybeFinish = () => {
    if (self.inputDone && !self.busy && !self.pending.length) io.port.postMessage({ type: "notify-idle" });
  };

  // Chunks are converted one at a time, in order. If the server is slower than real time,
  // the mic keeps only the newest couple of chunks; a file keeps them all, since it's
  // better to hear it late than to lose parts of it.
  const pump = async () => {
    if (self.busy || self.stopped || !self.pending.length) return maybeFinish();
    self.busy = true;
    const chunk = self.pending.shift();
    try {
      stats.sent++;
      const started = performance.now();
      const converted = await server.convert(toInt16(chunk.samples).buffer);
      if (!self.stopped) {
        options.onTiming?.(performance.now() - started);
        const samples = toFloat32(converted);
        io.port.postMessage({ type: "play", samples, startFrame: chunk.startFrame }, [samples.buffer]);
        stats.played++;
      }
    } catch (err) {
      stats.errors++;
      if (!self.stopped) self.onError?.(err);
    }
    self.busy = false;
    pump();
  };

  io.port.onmessage = (e) => {
    if (e.data.type === "end") {
      self.inputDone = true;
      return maybeFinish();
    }
    if (e.data.type === "idle") {
      if (self.stopped) return;
      stopVoice();
      return options.onEnded?.();
    }
    if (e.data.type === "latency") {
      // Recording a chunk to starting to play it; the sound card adds its own buffering on top.
      stats.latency = e.data.frames / ctx.sampleRate;
      return options.onLatency?.(stats.latency);
    }
    self.pending.push(e.data);
    while (!fromFile && self.pending.length > 2) {
      self.pending.shift();
      stats.dropped++;
    }
    pump();
  };
}

function stopVoice() {
  if (!run) return;
  run.stopped = true;
  run.stream?.getTracks().forEach((t) => t.stop());
  if (run.source) {
    run.source.onended = null;
    run.source.stop();
  }
  if (run.loopback) {
    run.loopback.pause();
    run.loopback.srcObject = null;
  }
  run.effects.stop();
  run.ctx.close();
  run = null;
}

// The output device only applies to the mic; a file always plays on the default speakers.
async function setOutputDevice(deviceId) {
  if (run && !run.fromFile && typeof run.ctx.setSinkId === "function") await run.ctx.setSinkId(sinkId(deviceId));
}

function setInputGain(percent) {
  if (run) run.inputGain.gain.value = percent / 100;
}

function setVolume(percent) {
  if (run) run.gain.gain.value = percent / 100;
}

function setListening(on) {
  if (run?.loopback) run.loopback.muted = !on;
}

function setChunk(chunk) {
  run?.io.port.postMessage({ type: "chunk", chunkSamples: chunk });
}

function setEffects(fx) {
  run?.effects.set(fx);
}

// Delay the audio system adds on the way in and out (the microphone driver's, the browser's
// and the sound card's buffers), as they report it. Null while nothing is running.
function ioLatency() {
  if (!run) return null;
  const input = run.stream?.getAudioTracks()[0]?.getSettings().latency ?? 0;
  return input + run.ctx.baseLatency + (run.ctx.outputLatency || 0);
}

window.VoicePlayAudio = { startVoice, stopVoice, setOutputDevice, setInputGain, setVolume, setListening, setChunk, setEffects, ioLatency, isRunning: () => !!run, stats: () => run?.stats };
