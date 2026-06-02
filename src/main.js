import "./styles.css";
import { openEpub, loadChapter } from "./epub-loader.js";
import {
  documentToBlocks,
  blocksToSentences,
} from "./text-extract.js";
import { SentencePipeline } from "./sentence-pipeline.js";
import {
  getServerInfo,
  fetchVoices,
  synthesizeSentence,
  probeServerTts,
  createAudioPlayer,
  createSpeechFallback,
  getApiKey,
  setApiKey,
} from "./tts.js";

const state = {
  book: null,
  chapters: [],
  title: "",
  currentChapter: null,
  blocks: [],
  sentences: [],
  blockIndexBySentence: [],
  currentSentenceIndex: 0,
  playing: false,
  paused: false,
  rate: 1,
  speaker: "Aria",
  emotion: "Neutral",
  voice: "Magpie-Multilingual.EN-US.Aria.Neutral",
  serverOnline: false,
  ttsMode: "browser",
  pipeline: null,
  playGeneration: 0,
};

const player = createAudioPlayer();
let speechFallback = null;

// Helper functions for Magpie voice management
function buildVoiceName() {
  return `Magpie-Multilingual.EN-US.${state.speaker}.${state.emotion}`;
}

function updateVoice() {
  const wasPlaying = state.playing && !state.paused;
  const currentIndex = state.currentSentenceIndex;
  
  // Update voice
  state.voice = buildVoiceName();
  
  // Reset pipeline with new voice
  state.pipeline?.reset();
  
  // If currently playing, restart from current sentence with new voice
  if (wasPlaying) {
    stopPlayback();
    setTimeout(() => {
      state.currentSentenceIndex = currentIndex;
      playFromCurrent();
    }, 100);
  }
}

const el = {
  app: document.getElementById("app"),
  statusPill: null,
  chapterSelect: null,
  readerContent: null,
  voiceSelect: null,
  emotionSelect: null,
  playBtn: null,
  progressFill: null,
  progressLabel: null,
  pipelineReady: null,
  pipelineLoading: null,
  apiKeyInput: null,
};

function renderShell() {
  el.app.innerHTML = `
    <header class="header">
      <h1>EPUB <span>→</span> Audiobook</h1>
      <div class="header-actions">
        <div class="api-key-group">
          <input type="password" id="api-key-input" class="api-key-input" placeholder="NVIDIA API Key (nvapi-...)" />
          <button class="btn btn-sm" id="btn-save-key">Save Key</button>
          <a href="https://build.nvidia.com/nvidia/magpie-tts-multilingual" target="_blank" rel="noopener noreferrer" class="api-key-link">Get Key ↗</a>
        </div>
        <span class="status-pill" id="status-pill">Checking server…</span>
        <label class="file-btn btn btn-primary">
          Open EPUB
          <input type="file" accept=".epub,application/epub+zip" id="file-input" />
        </label>
      </div>
    </header>
    <p class="error-banner hidden" id="error-banner" role="alert"></p>
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-section">
          <label>Chapter</label>
          <p class="reader-meta" id="book-title">No book loaded</p>
          <select id="chapter-select" class="chapter-select" disabled>
            <option value="-1">— Select a chapter —</option>
          </select>
        </div>
      </aside>
      <div class="main">
        <div class="reader-toolbar">
          <span class="reader-meta" id="chapter-label">Select a chapter</span>
          <div class="pipeline-status">
            <span class="pipeline-dot" id="dot-ready"></span>
            <span id="pipeline-ready">0 ready</span>
            <span class="pipeline-dot loading" id="dot-loading"></span>
            <span id="pipeline-loading">0 loading</span>
          </div>
        </div>
        <article class="reader-content" id="reader-content">
          <p class="placeholder">Upload an EPUB, pick a chapter, then press Play to hear sentence-by-sentence audio with the next sentence synthesized in parallel.</p>
        </article>
        <footer class="player-bar">
          <div class="player-controls">
            <button class="btn btn-icon" id="btn-prev" title="Previous sentence" disabled>⏮</button>
            <button class="btn btn-icon btn-primary" id="btn-play" title="Play" disabled>▶</button>
            <button class="btn btn-icon" id="btn-next" title="Next sentence" disabled>⏭</button>
            <button class="btn" id="btn-stop" disabled>Stop</button>
          </div>
          <div class="progress-wrap">
            <div class="progress-label">
              <span id="progress-text">—</span>
              <span id="progress-pct">0%</span>
            </div>
            <div class="progress-track" id="progress-track">
              <div class="progress-fill" id="progress-fill" style="width:0%"></div>
            </div>
          </div>
          <div class="voice-controls">
            <label for="voice-select">Voice</label>
            <select id="voice-select" disabled>
              <option value="Aria">Loading...</option>
            </select>
            <label for="emotion-select">Emotion</label>
            <select id="emotion-select" disabled>
              <option value="Neutral">Loading...</option>
            </select>
          </div>
          <div class="speed-control">
            <label for="rate">Speed</label>
            <input type="range" id="rate" min="0.75" max="1.75" step="0.05" value="1" />
            <span id="rate-label">1.0×</span>
          </div>
        </footer>
      </div>
    </div>
  `;

  el.statusPill = document.getElementById("status-pill");
  el.chapterSelect = document.getElementById("chapter-select");
  el.readerContent = document.getElementById("reader-content");
  el.voiceSelect = document.getElementById("voice-select");
  el.emotionSelect = document.getElementById("emotion-select");
  el.playBtn = document.getElementById("btn-play");
  el.progressFill = document.getElementById("progress-fill");
  el.progressLabel = document.getElementById("progress-text");
  el.pipelineReady = document.getElementById("pipeline-ready");
  el.pipelineLoading = document.getElementById("pipeline-loading");
  el.dotReady = document.getElementById("dot-ready");
  el.dotLoading = document.getElementById("dot-loading");
  el.errorBanner = document.getElementById("error-banner");
  el.apiKeyInput = document.getElementById("api-key-input");

  // Restore saved API key into input
  const savedKey = getApiKey();
  if (savedKey) {
    el.apiKeyInput.value = savedKey;
    el.apiKeyInput.type = "password";
  }

  // API key save handler
  document.getElementById("btn-save-key").addEventListener("click", async () => {
    const key = el.apiKeyInput.value.trim();
    if (!key) {
      showError("Please enter an API key.");
      return;
    }
    setApiKey(key);
    el.statusPill.textContent = "Key saved, reconnecting\u2026";
    // Re-check server and load voices
    const serverInfo = await getServerInfo();
    state.serverOnline = !!serverInfo?.ok;
    if (state.serverOnline) {
      await loadVoices();
      const works = await probeServerTts(state.voice);
      state.ttsMode = works ? "server" : "browser";
      if (!works) {
        showError("API key saved but TTS test failed \u2014 using browser voice.");
      } else {
        showError("");
      }
    }
    updateServerStatus();
  });

  // Allow Enter key to save
  el.apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      document.getElementById("btn-save-key").click();
    }
  });

  document.getElementById("file-input").addEventListener("change", onFileSelected);
  el.playBtn.addEventListener("click", togglePlay);
  document.getElementById("btn-stop").addEventListener("click", stopPlayback);
  document.getElementById("btn-prev").addEventListener("click", () => jumpSentence(-1));
  document.getElementById("btn-next").addEventListener("click", () => jumpSentence(1));
  document.getElementById("progress-track").addEventListener("click", onProgressClick);
  el.voiceSelect.addEventListener("change", () => {
    state.speaker = el.voiceSelect.value;
    updateVoice();
  });
  el.emotionSelect.addEventListener("change", () => {
    state.emotion = el.emotionSelect.value;
    updateVoice();
  });
  document.getElementById("rate").addEventListener("input", (e) => {
    state.rate = Number(e.target.value);
    document.getElementById("rate-label").textContent = `${state.rate.toFixed(2)}×`;
  });
  el.chapterSelect.addEventListener("change", (e) => {
    const idx = Number(e.target.value);
    if (idx >= 0) {
      selectChapter(idx);
    }
  });
}

function showError(message) {
  if (!message) {
    el.errorBanner.textContent = "";
    el.errorBanner.classList.add("hidden");
    return;
  }
  el.errorBanner.textContent = message;
  el.errorBanner.classList.remove("hidden");
}

async function synthesizeForPipeline(text) {
  if (state.ttsMode === "server") {
    try {
      const blob = await synthesizeSentence(text, state.voice);
      return { type: "audio", blob };
    } catch (err) {
      console.warn("Server TTS failed, using browser:", err);
      state.ttsMode = "browser";
      updateServerStatus();
      showError(
        "Cloud TTS unavailable \u2014 using your Mac/browser voice instead. Audio should still play."
      );
    }
  }
  return speechFallback.synthesize(text);
}

async function playItem(item, sentenceText, rate) {
  if (item?.type === "audio" && item.blob) {
    await player.play(item.blob, rate);
    return;
  }
  const speechItem =
    item?.type === "speech"
      ? item
      : { type: "speech", text: sentenceText };
  await speechFallback.play(speechItem, rate);
}

async function init() {
  renderShell();
  speechFallback = createSpeechFallback();

  const serverInfo = await getServerInfo();
  state.serverOnline = !!serverInfo?.ok;
  if (state.serverOnline) {
    await loadVoices();
    if (serverInfo.macos_say) {
      state.ttsMode = "server";
    } else {
      const works = await probeServerTts(state.voice);
      state.ttsMode = works ? "server" : "browser";
      if (!works) {
        showError(
          "Cloud TTS unavailable \u2014 using browser voice. Press Play to listen."
        );
      }
    }
  } else {
    state.ttsMode = "browser";
    el.voiceSelect.innerHTML =
      '<option value="browser">Browser voice</option>';
    el.voiceSelect.disabled = true;
  }
  updateServerStatus();

  state.pipeline = new SentencePipeline({
    synthesize: synthesizeForPipeline,
    onStatus: ({ ready, loading }) => {
      el.pipelineReady.textContent = `${ready} ready`;
      el.pipelineLoading.textContent = `${loading} loading`;
      el.dotReady.classList.toggle("ready", ready > 0);
      el.dotLoading.classList.toggle("loading", loading > 0);
    },
    lookahead: 2,
  });

  // If no API key is set, show a hint
  if (!getApiKey()) {
    showError(
      "No API key set. Enter your NVIDIA API key above to use cloud TTS. Get one at build.nvidia.com/nvidia/magpie-tts-multilingual"
    );
  }
}

async function loadVoices() {
  try {
    const voices = await fetchVoices();
    
    // Extract unique speakers and emotions from Magpie voices
    const speakers = [...new Set(voices.map(v => v.speaker))];
    const emotions = [...new Set(voices.map(v => v.emotion))];
    
    // Populate speaker (voice) dropdown
    el.voiceSelect.innerHTML = speakers
      .map(s => `<option value="${s}">${s}</option>`)
      .join("");
    
    // Populate emotion dropdown
    el.emotionSelect.innerHTML = emotions
      .map(e => `<option value="${e}">${e}</option>`)
      .join("");
    
    el.voiceSelect.disabled = false;
    el.emotionSelect.disabled = false;
    
    // Set default selections
    state.speaker = "Aria";
    state.emotion = "Neutral";
    el.voiceSelect.value = state.speaker;
    el.emotionSelect.value = state.emotion;
    updateVoice();
  } catch (err) {
    console.error("Failed to load voices:", err);
    // Provide fallback options
    el.voiceSelect.innerHTML = '<option value="Aria">Aria</option><option value="Mia">Mia</option>';
    el.emotionSelect.innerHTML = '<option value="Neutral">Neutral</option>';
    el.voiceSelect.disabled = false;
    el.emotionSelect.disabled = false;
    state.speaker = "Aria";
    state.emotion = "Neutral";
    updateVoice();
  }
}

function updateServerStatus() {
  const labels = {
    server: "Server TTS (parallel)",
    browser: "Browser / Mac voice",
  };
  el.statusPill.textContent = labels[state.ttsMode] || labels.browser;
  el.statusPill.className = `status-pill ${state.ttsMode === "server" ? "online" : "offline"}`;
}

async function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  stopPlayback();
  el.readerContent.innerHTML =
    '<p class="placeholder">Loading EPUB\u2026</p>';

  try {
    const { book, chapters, title } = await openEpub(file);
    state.book = book;
    state.chapters = chapters;
    state.title = title;
    document.getElementById("book-title").textContent = title;
    renderChapterDropdown();
    el.readerContent.innerHTML =
      '<p class="placeholder">Choose a chapter from the sidebar.</p>';
  } catch (err) {
    el.readerContent.innerHTML = `<p class="placeholder">Failed to open EPUB: ${err.message}</p>`;
  }
}

function renderChapterDropdown() {
  el.chapterSelect.innerHTML = '<option value="-1">\u2014 Select a chapter \u2014</option>';
  state.chapters.forEach((ch, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = ch.label;
    if (state.currentChapter?.id === ch.id) {
      opt.selected = true;
    }
    el.chapterSelect.appendChild(opt);
  });
  el.chapterSelect.disabled = false;
}

async function selectChapter(index) {
  const chapter = state.chapters[index];
  if (!chapter || !state.book) return;

  stopPlayback();
  state.currentChapter = chapter;
  state.currentSentenceIndex = 0;
  state.pipeline.reset();

  document.getElementById("chapter-label").textContent = chapter.label;
  el.chapterSelect.value = index;
  el.readerContent.innerHTML = '<p class="placeholder">Loading chapter\u2026</p>';

  try {
    const { doc } = await loadChapter(state.book, chapter);
    state.blocks = documentToBlocks(doc);
    const { sentences, blockIndexBySentence } = blocksToSentences(state.blocks);
    state.sentences = sentences;
    state.blockIndexBySentence = blockIndexBySentence;

    renderReader();
    setControlsEnabled(sentences.length > 0);
    updateProgress();
  } catch (err) {
    el.readerContent.innerHTML = `<p class="placeholder">Could not load chapter: ${err.message}</p>`;
    setControlsEnabled(false);
  }
}

function renderReader() {
  if (!state.sentences.length) {
    el.readerContent.innerHTML =
      '<p class="placeholder">No readable text in this chapter.</p>';
    return;
  }

  let sentenceIdx = 0;
  const parts = [];

  for (let bi = 0; bi < state.blocks.length; bi++) {
    const block = state.blocks[bi];
    const indices = [];
    while (
      sentenceIdx < state.sentences.length &&
      state.blockIndexBySentence[sentenceIdx] === bi
    ) {
      indices.push(sentenceIdx++);
    }
    if (!indices.length) continue;

    const spans = indices
      .map(
        (i) =>
          `<span class="sentence" data-sentence="${i}">${escapeHtml(state.sentences[i])}</span>`
      )
      .join(" ");

    if (block.type === "h") {
      parts.push(`<h${block.level}>${spans}</h${block.level}>`);
    } else if (block.type === "li") {
      parts.push(`<p class="list-item">${spans}</p>`);
    } else {
      parts.push(`<p>${spans}</p>`);
    }
  }

  el.readerContent.innerHTML = parts.join("\n");

  el.readerContent.querySelectorAll(".sentence").forEach((span) => {
    span.addEventListener("click", () => {
      jumpToSentence(Number(span.dataset.sentence));
    });
  });

  highlightSentence(state.currentSentenceIndex);
}

function highlightSentence(index) {
  el.readerContent.querySelectorAll(".sentence").forEach((span) => {
    const i = Number(span.dataset.sentence);
    span.classList.toggle("active", i === index);
    span.classList.toggle("played", i < index);
  });

  const active = el.readerContent.querySelector(`.sentence[data-sentence="${index}"]`);
  active?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function setControlsEnabled(enabled) {
  el.playBtn.disabled = !enabled;
  document.getElementById("btn-stop").disabled = !enabled;
  document.getElementById("btn-prev").disabled = !enabled;
  document.getElementById("btn-next").disabled = !enabled;
}

function updateProgress() {
  const total = state.sentences.length;
  const current = total ? state.currentSentenceIndex + 1 : 0;
  const pct = total ? Math.round((state.currentSentenceIndex / total) * 100) : 0;

  el.progressFill.style.width = `${pct}%`;
  document.getElementById("progress-pct").textContent = `${pct}%`;
  el.progressLabel.textContent =
    total > 0 ? `Sentence ${current} / ${total}` : "\u2014";
  el.playBtn.textContent = state.playing && !state.paused ? "\u23f8" : "\u25b6";
}

async function togglePlay() {
  if (state.playing && !state.paused) {
    state.paused = true;
    player.pause();
    speechFallback?.stop();
    updateProgress();
    return;
  }

  if (state.paused) {
    state.paused = false;
    if (state.ttsMode === "server") {
      player.resume();
    } else {
      await playFromCurrent();
    }
    updateProgress();
    return;
  }

  await playFromCurrent();
}

async function playFromCurrent() {
  if (!state.sentences.length) return;

  state.playing = true;
  state.paused = false;
  const gen = ++state.playGeneration;
  
  // Synchronize pipeline generation to prevent "cancelled" errors
  state.pipeline.generation = gen;

  for (let i = state.currentSentenceIndex; i < state.sentences.length; i++) {
    if (gen !== state.playGeneration || !state.playing || state.paused) break;

    state.currentSentenceIndex = i;
    highlightSentence(i);
    updateProgress();

    try {
      const item = await state.pipeline.getReady(
        i,
        state.sentences,
        state.voice,
        gen
      );

      if (gen !== state.playGeneration) break;

      state.pipeline.prefetchRange(state.sentences, i + 1, state.voice, gen);

      await playItem(item, state.sentences[i], state.rate);
    } catch (err) {
      if (gen === state.playGeneration) {
        console.error(err);
        showError(`Playback error: ${err.message}. Try pressing Play again.`);
      }
      break;
    }
  }

  if (gen === state.playGeneration) {
    state.playing = false;
    state.paused = false;
    updateProgress();
  }
}

function stopPlayback() {
  state.playGeneration++;
  state.playing = false;
  state.paused = false;
  player.stop();
  speechFallback?.stop();
  state.pipeline?.reset();
  updateProgress();
}

function jumpSentence(delta) {
  const next = state.currentSentenceIndex + delta;
  if (next < 0 || next >= state.sentences.length) return;
  jumpToSentence(next);
}

function jumpToSentence(index) {
  stopPlayback();
  state.currentSentenceIndex = index;
  highlightSentence(index);
  updateProgress();
  playFromCurrent();
}

function onProgressClick(e) {
  if (!state.sentences.length) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const index = Math.min(
    state.sentences.length - 1,
    Math.floor(ratio * state.sentences.length)
  );
  jumpToSentence(index);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();
