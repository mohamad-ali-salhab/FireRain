/**
 * Every sound is synthesised with the WebAudio API — no asset downloads,
 * so the whole game stays a single self-contained bundle.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let noiseBuffer: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 1.6);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

export const audio = {
  init(): void {
    ac();
  },

  get muted(): boolean {
    return muted;
  },

  setMuted(v: boolean): void {
    muted = v;
    if (master && ctx) master.gain.setTargetAtTime(v ? 0 : 0.5, ctx.currentTime, 0.02);
  },

  /**
   * @param pan -1 (far left) .. 1 (far right), used so off-screen action is
   *            still audible in the right ear.
   */
  launch(tier: number, pan = 0): void {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    const out = panner(c, pan, 0.55);

    // Rocket motor: filtered noise that opens up as it climbs.
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(180 + tier * 60, t);
    bp.frequency.exponentialRampToValueAtTime(900 + tier * 220, t + 0.5);
    bp.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.9);

    // Low thump on ignition.
    const osc = c.createOscillator();
    const og = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 - tier * 6, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    og.gain.setValueAtTime(0.55, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.42);
  },

  interceptorLaunch(pan = 0): void {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    const out = panner(c, pan, 0.4);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.22);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.32);
  },

  intercept(pan = 0): void {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    const out = panner(c, pan, 0.6);
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(hp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.32);

    const osc = c.createOscillator();
    const og = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    og.gain.setValueAtTime(0.25, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.22);
  },

  explosion(power: number, pan = 0): void {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    const p = Math.max(0.3, Math.min(2.2, power));
    const out = panner(c, pan, 0.75);

    const src = c.createBufferSource();
    src.buffer = noise(c);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400 / p, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.6 * p);
    const g = c.createGain();
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75 * p);
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.8 * p);

    const sub = c.createOscillator();
    const sg = c.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(90 / p, t);
    sub.frequency.exponentialRampToValueAtTime(26, t + 0.5 * p);
    sg.gain.setValueAtTime(0.7, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 * p);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.62 * p);
  },

  collapse(pan = 0): void {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    const out = panner(c, pan, 0.5);
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 1.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 1.55);
  },

  build(): void {
    if (!ac() || muted) return;
    blip(760, 0.09, 'square', 0.16);
    setTimeout(() => blip(1140, 0.08, 'square', 0.12), 55);
  },

  buy(): void {
    if (!ac() || muted) return;
    blip(520, 0.07, 'triangle', 0.2);
    setTimeout(() => blip(780, 0.09, 'triangle', 0.16), 60);
  },

  click(): void {
    blip(420, 0.045, 'square', 0.1);
  },

  deny(): void {
    blip(160, 0.16, 'sawtooth', 0.14);
  },

  pin(): void {
    blip(980, 0.05, 'sine', 0.14);
  },

  alarm(): void {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sawtooth';
      const s = t + i * 0.42;
      osc.frequency.setValueAtTime(420, s);
      osc.frequency.linearRampToValueAtTime(700, s + 0.2);
      osc.frequency.linearRampToValueAtTime(420, s + 0.38);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.18, s + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.4);
      osc.connect(g).connect(master!);
      osc.start(s);
      osc.stop(s + 0.42);
    }
  },

  fanfare(win: boolean): void {
    if (!ac() || muted) return;
    const notes = win ? [523, 659, 784, 1047] : [523, 466, 392, 311];
    notes.forEach((f, i) => setTimeout(() => blip(f, 0.28, 'triangle', 0.22), i * 150));
  },
};

function blip(freq: number, dur: number, type: OscillatorType, vol: number): void {
  const c = ac();
  if (!c || muted || !master) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function panner(c: AudioContext, pan: number, vol: number): AudioNode {
  const g = c.createGain();
  g.gain.value = vol;
  if (typeof c.createStereoPanner === 'function') {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(master!);
  } else {
    g.connect(master!);
  }
  return g;
}
