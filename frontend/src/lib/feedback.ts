// Lightweight sound + vibration feedback helpers. Sounds are short synthesized
// beeps via WebAudio (no binary asset files needed); swap in real audio files
// under /public/sounds later if you want richer effects.
//
// Haptics use the Vibration API where supported. iOS Safari does not expose
// navigator.vibrate at all, so every helper must no-op gracefully — never throw.
// All patterns respect the user's feedback settings.

function settings() {
  return {
    sound: localStorage.getItem("lj_sound") !== "off" && localStorage.getItem("lj_mute") !== "on",
    vibration: localStorage.getItem("lj_vibration") !== "off",
  };
}

// Single source of truth for the universal mute toggle: it drives sound only.
// lj_sound is the active key; lj_mute is kept as a legacy alias (pre-existing
// values written by old builds) so any stored "on" also silences sound.
// Vibration is intentionally NOT part of mute — it is controlled separately by
// lj_vibration so haptics survive silent mode (task rule: mute is for sound).
export function setMutedState(muted: boolean) {
  localStorage.setItem("lj_sound", muted ? "off" : "on");
  if (muted) localStorage.setItem("lj_mute", "on");
  else localStorage.removeItem("lj_mute");
}

export function isMuted(): boolean {
  return localStorage.getItem("lj_sound") === "off" || localStorage.getItem("lj_mute") === "on";
}

export function isVibrationEnabled(): boolean {
  return localStorage.getItem("lj_vibration") !== "off";
}

export function setPreference(key: "sound" | "vibration" | "mute", value: boolean) {
  if (key === "sound" || key === "mute") {
    setMutedState(!value);
    return;
  }
  localStorage.setItem("lj_vibration", value ? "on" : "off");
}

// Only buzz when the tab is actually visible — browsers generally ignore
// vibrate() in the background anyway, but this avoids relying on that.
function canVibrate() {
  return typeof navigator !== "undefined" && "vibrate" in navigator && document.visibilityState === "visible";
}

export function vibrate(pattern: number | number[] = 30) {
  const { vibration } = settings();
  if (!vibration || !canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // unsupported / blocked — ignore
  }
}

// Named intensities so call sites read clearly instead of guessing patterns.
export const haptic = {
  // Navigation, toggles, small button presses.
  light: () => vibrate(8),
  // Sending a message, hug, kiss, important interactions.
  medium: () => vibrate([14, 40, 18]),
  // Game success, streak milestone, major romantic event.
  strong: () => vibrate([22, 40, 22, 40, 26]),
  error: () => vibrate([30, 30, 30]),
};

let audioCtx: AudioContext | null = null;

export function playTone(freq = 660, durationMs = 120, type: OscillatorType = "sine") {
  const { sound } = settings();
  if (!sound) return;
  try {
    audioCtx = audioCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch {
    // ignore audio errors (e.g. autoplay restrictions before first user gesture)
  }
}

export const sounds = {
  tap: () => playTone(520, 80),
  success: () => playTone(880, 180),
  jarOpen: () => playTone(700, 300, "triangle"),
  message: () => playTone(440, 100),
  hug: () => playTone(620, 260, "triangle"),
  kiss: () => playTone(920, 240, "triangle"),
  milestone: () => playTone(660, 160, "triangle"),
  error: () => playTone(220, 200, "sawtooth"),
};
