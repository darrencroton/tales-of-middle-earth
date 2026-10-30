/**
 * The shared audio graph: music and sound buses, a muffling filter for the
 * music, a reverb and an echo, and the noise and waveforms the
 * instruments are built from.
 *
 *   music players → musicTone → EQ → musicDuck → musicVolume → master → limiter → speakers
 *   sound effects, ambience → high-pass → soundVolume → master
 *   musicVolume, soundVolume → sends → high-pass → reverb / echo → master
 */
export class AudioCore {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly musicIn: GainNode;
  readonly musicTone: BiquadFilterNode;
  readonly musicVolume: GainNode;
  /** Dips the music under a sound that should stand out (`duck`). */
  readonly musicDuck: GainNode;
  readonly soundIn: GainNode;
  readonly soundVolume: GainNode;
  readonly ambienceIn: GainNode;
  readonly musicReverb: GainNode;
  readonly musicEcho: GainNode;
  readonly soundReverb: GainNode;
  readonly noise: AudioBuffer;
  readonly brownNoise: AudioBuffer;
  private readonly waves = new Map<string, PeriodicWave>();
  private readonly lfos = new Map<number, OscillatorNode>();
  private duckDepth = 1;
  private duckUntil = 0;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(limiter);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulseResponse(ctx, 3.4, 2.6);
    const reverbIn = ctx.createGain();
    const reverbLow = biquad(ctx, 'highpass', 220, 0.6);
    reverbIn.connect(reverbLow);
    reverbLow.connect(reverb);
    reverb.connect(this.master);

    const echoIn = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2200;
    echoIn.connect(delay);
    delay.connect(echoTone);
    echoTone.connect(feedback);
    feedback.connect(delay);
    echoTone.connect(this.master);
    echoTone.connect(reverbIn);

    this.musicIn = ctx.createGain();
    this.musicTone = ctx.createBiquadFilter();
    this.musicTone.type = 'lowpass';
    this.musicTone.frequency.value = 18000;
    this.musicTone.Q.value = 0.4;
    this.musicVolume = ctx.createGain();
    const rumble = biquad(ctx, 'highpass', 48, 0.7);
    const mud = biquad(ctx, 'lowshelf', 160, 0.7, -4);
    const presence = biquad(ctx, 'highshelf', 3500, 0.7, 2);
    this.musicIn.connect(this.musicTone);
    this.musicTone.connect(rumble);
    rumble.connect(mud);
    mud.connect(presence);
    this.musicDuck = ctx.createGain();
    presence.connect(this.musicDuck);
    this.musicDuck.connect(this.musicVolume);
    this.musicVolume.connect(this.master);
    this.musicReverb = ctx.createGain();
    this.musicReverb.gain.value = 0.5;
    this.musicVolume.connect(this.musicReverb);
    this.musicReverb.connect(reverbIn);
    this.musicEcho = ctx.createGain();
    this.musicEcho.gain.value = 0;
    this.musicVolume.connect(this.musicEcho);
    this.musicEcho.connect(echoIn);

    this.soundIn = ctx.createGain();
    this.ambienceIn = ctx.createGain();
    this.soundVolume = ctx.createGain();
    const soundLow = biquad(ctx, 'highpass', 38, 0.7);
    this.soundIn.connect(soundLow);
    this.ambienceIn.connect(soundLow);
    soundLow.connect(this.soundVolume);
    this.soundVolume.connect(this.master);
    this.soundReverb = ctx.createGain();
    this.soundReverb.gain.value = 0.25;
    this.soundVolume.connect(this.soundReverb);
    this.soundReverb.connect(reverbIn);

    this.noise = whiteNoise(ctx, 2);
    this.brownNoise = brownNoise(ctx, 4);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Lowers the music by `db` from `t` for about `hold` seconds, then lets it swell back; overlapping dips keep the deepest level and the latest end, and a dip never lifts music still swelling back. */
  duck(t: number, db: number, hold: number): void {
    const gain = this.musicDuck.gain;
    const active = t < this.duckUntil;
    this.duckDepth = Math.min(Math.pow(10, -db / 20), active ? this.duckDepth : gain.value);
    this.duckUntil = Math.max(t + hold, active ? this.duckUntil : 0);
    gain.cancelScheduledValues(t);
    gain.setTargetAtTime(this.duckDepth, t, 0.015);
    gain.setTargetAtTime(1, this.duckUntil, 0.3);
  }

  /**
   * A periodic waveform from harmonic amplitudes, cached by name.
   * Index 0 of `harmonics` is the fundamental.
   */
  wave(name: string, harmonics: () => number[]): PeriodicWave {
    let wave = this.waves.get(name);
    if (!wave) {
      const amps = harmonics();
      const real = new Float32Array(amps.length + 1);
      const imag = new Float32Array(amps.length + 1);
      amps.forEach((a, i) => (imag[i + 1] = a));
      wave = this.ctx.createPeriodicWave(real, imag);
      this.waves.set(name, wave);
    }
    return wave;
  }

  /** A free-running sine shared by every note that wants vibrato at this rate. */
  lfo(rate: number): OscillatorNode {
    let lfo = this.lfos.get(rate);
    if (!lfo) {
      lfo = this.ctx.createOscillator();
      lfo.frequency.value = rate;
      lfo.start();
      this.lfos.set(rate, lfo);
    }
    return lfo;
  }

  noiseSource(brown = false): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = brown ? this.brownNoise : this.noise;
    source.loop = true;
    source.loopStart = 0;
    return source;
  }
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q: number, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  return buffer;
}

function brownNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 4321;
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    const white = (seed / 2147483647) * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  /* Fade the ends together so the loop is seamless. */
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    data[i] = data[i] * k + data[data.length - fade + i] * (1 - k);
  }
  return buffer;
}

/** Stereo reverb tail: decaying noise that darkens as it fades. */
function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let seed = channel ? 98765 : 12345;
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      seed = (seed * 16807) % 2147483647;
      const white = (seed / 2147483647) * 2 - 1;
      const t = i / length;
      const k = 0.15 + 0.8 * t;
      smooth = smooth * k + white * (1 - k);
      const early = i < ctx.sampleRate * 0.012 ? 0 : 1;
      data[i] = smooth * Math.pow(1 - t, decay) * early * (1.6 + t);
    }
  }
  return buffer;
}
