const API_BASE = import.meta.env.VITE_API_URL || "";

export function getApiKey() {
  return localStorage.getItem("tts_api_key") || "";
}

export function setApiKey(key) {
  localStorage.setItem("tts_api_key", key || "");
}

export async function getServerInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function checkServerHealth() {
  const info = await getServerInfo();
  return !!info?.ok;
}

export async function fetchVoices() {
  const res = await fetch(`${API_BASE}/api/voices`, {
    headers: { "X-API-Key": getApiKey() },
  });
  if (!res.ok) throw new Error("Failed to load voices");
  const data = await res.json();
  return data.voices || [];
}

export function isValidAudioBlob(blob) {
  if (!(blob instanceof Blob) || blob.size < 400) return false;
  const type = blob.type || "";
  if (type.includes("json") || type.includes("text")) return false;
  return true;
}

export async function synthesizeSentence(text, voice) {
  const res = await fetch(`${API_BASE}/api/tts`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "X-API-Key": getApiKey()
    },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err.detail === "string"
        ? err.detail
        : err.detail || `TTS failed (${res.status})`
    );
  }
  const blob = await res.blob();
  if (!isValidAudioBlob(blob)) {
    throw new Error("Server returned invalid audio");
  }
  return blob;
}

/** Probe whether server TTS actually produces audio. */
export async function probeServerTts(voice) {
  try {
    const blob = await synthesizeSentence("Ready.", voice);
    return isValidAudioBlob(blob);
  } catch {
    return false;
  }
}

export async function ensureSpeechReady() {
  if (typeof speechSynthesis === "undefined") return false;
  if (speechSynthesis.getVoices().length > 0) return true;
  return new Promise((resolve) => {
    const finish = () => resolve(speechSynthesis.getVoices().length > 0);
    speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    setTimeout(finish, 1000);
  });
}

/**
 * Browser speech synthesis (works offline; used when server TTS fails).
 */
export function createSpeechFallback() {
  let utterance = null;
  let resolveEnd = null;
  let preferredVoice = null;

  async function pickVoice() {
    await ensureSpeechReady();
    const voices = speechSynthesis.getVoices();
    preferredVoice =
      voices.find((v) => v.lang.startsWith("en") && v.localService) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      voices[0] ||
      null;
  }

  function cancel() {
    speechSynthesis.cancel();
    if (resolveEnd) {
      const r = resolveEnd;
      resolveEnd = null;
      r();
    }
  }

  pickVoice();

  return {
    async synthesize(text) {
      return { type: "speech", text };
    },
    async play(item, rate = 1) {
      cancel();
      if (item?.type !== "speech") return;

      await pickVoice();

      return new Promise((resolve, reject) => {
        utterance = new SpeechSynthesisUtterance(item.text);
        utterance.rate = rate;
        utterance.volume = 1;
        if (preferredVoice) utterance.voice = preferredVoice;

        utterance.onend = () => {
          resolveEnd = null;
          resolve();
        };
        utterance.onerror = (e) => {
          resolveEnd = null;
          reject(new Error(e.error || "Speech synthesis failed"));
        };

        resolveEnd = resolve;
        // Chrome: resume if paused, speak after short delay
        speechSynthesis.resume();
        speechSynthesis.speak(utterance);
      });
    },
    stop: cancel,
  };
}

export function createAudioPlayer() {
  let audio = null;
  let objectUrl = null;

  function cleanup() {
    if (audio) {
      audio.pause();
      audio.src = "";
      audio.onended = null;
      audio.onerror = null;
      audio = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  return {
    play(blob, rate = 1) {
      cleanup();
      return new Promise((resolve, reject) => {
        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
        audio.playbackRate = rate;
        audio.volume = 1;
        audio.onended = () => {
          cleanup();
          resolve();
        };
        audio.onerror = () => {
          cleanup();
          reject(new Error("Playback failed"));
        };
        const tryPlay = () => audio.play().catch(reject);
        tryPlay();
      });
    },
    stop() {
      cleanup();
    },
    pause() {
      audio?.pause();
    },
    resume() {
      audio?.play()?.catch(() => {});
    },
    get paused() {
      return audio?.paused ?? true;
    },
  };
}
