// Ported from Sugar Glitch Demo.html's beep() WebAudio synth, unchanged.

let actx: AudioContext | null = null;
let soundOn = true;

export function setSound(on: boolean) {
  soundOn = on;
}

export function beep(type: "move" | "select" | "glitch") {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const t = actx.currentTime;
    if (type === "move") {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(340, t + 0.09);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + 0.13);
    } else if (type === "select") {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(660, t);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + 0.09);
    } else if (type === "glitch") {
      for (let i = 0; i < 5; i++) {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = "square";
        o.frequency.setValueAtTime(180 + Math.random() * 900, t + i * 0.045);
        g.gain.setValueAtTime(0.055, t + i * 0.045);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.045 + 0.05);
        o.connect(g).connect(actx.destination);
        o.start(t + i * 0.045);
        o.stop(t + i * 0.045 + 0.06);
      }
      const o2 = actx.createOscillator();
      const g2 = actx.createGain();
      o2.type = "triangle";
      o2.frequency.setValueAtTime(140, t + 0.22);
      o2.frequency.exponentialRampToValueAtTime(60, t + 0.4);
      g2.gain.setValueAtTime(0.14, t + 0.22);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      o2.connect(g2).connect(actx.destination);
      o2.start(t + 0.22);
      o2.stop(t + 0.43);
    }
  } catch {
    // audio unsupported/blocked — silently no-op, matches demo behavior
  }
}
