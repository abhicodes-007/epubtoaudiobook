# EPUB → Audiobook

A web app that turns EPUB chapters into listenable audiobooks, one sentence at a time. While you hear the current sentence, the next one is synthesized in parallel so playback stays smooth.

## Features

- Upload any `.epub` file in the browser
- Pick a chapter from the **dropdown selector**
- Text is extracted with headings, paragraphs, and list items preserved
- Sentence-by-sentence playback with live highlighting
- **Parallel pipeline**: prefetches the next 1–2 sentences while the current one plays
- Click any sentence to jump there
- Adjustable speed and voice selection
- **Bring your own API key** — powered by [NVIDIA Magpie TTS](https://build.nvidia.com/nvidia/magpie-tts-multilingual)

## Quick start

You need **two terminals**: the Python TTS server and the Vite frontend.

### 1. Backend (TTS server)

```bash
cd epubtoaudiobook
python3 -m venv .venv                    # Python 3.10+ required
source .venv/bin/activate                 # Windows: .venv\Scripts\activate
pip install -r server/requirements.txt
uvicorn server.main:app --reload --port 8000
```

### 2. Frontend

Open a **new terminal tab**:

```bash
cd epubtoaudiobook
npm install
npm run dev
```

### 3. Open the app

Open [http://localhost:5173](http://localhost:5173) in your browser.

1. Get your API key from [NVIDIA Magpie TTS](https://build.nvidia.com/nvidia/magpie-tts-multilingual)
2. Paste it into the **API Key** field in the header
3. Click **Save Key**
4. Upload an `.epub` file and select a chapter from the dropdown
5. Click **Play ▶**

> 📖 See [RUN_TUTORIAL.md](file:///Users/abhi/Desktop/9routerapi/epubtoaudiobook/RUN_TUTORIAL.md) for a detailed step-by-step guide.

### Browser-only fallback

If the server is not running, the app falls back to the browser's built-in speech synthesis. Playback still works, but sentences are processed sequentially (no real parallel prefetch).

## How the pipeline works

```
Sentence 0  [PLAYING]  ──────────────────────────────►
Sentence 1  [READY]     (fetched while 0 plays)
Sentence 2  [LOADING]   (fetched while 0 plays)
```

When sentence *N* starts playing, the app requests TTS for *N+1* and *N+2* from `/api/tts`. When *N* ends, *N+1* is usually already cached and plays immediately.

## Tech stack

- **Frontend**: Vite, [epub.js](https://github.com/futurepress/epub.js), `Intl.Segmenter` for sentence splitting
- **Backend**: FastAPI + [NVIDIA Riva TTS](https://build.nvidia.com/nvidia/magpie-tts-multilingual) (user-provided API key)

## Project layout

```
epubtoaudiobook/
├── src/           # Web UI
│   ├── main.js        # App entry, chapter dropdown, API key UI
│   ├── tts.js         # TTS API calls, key management
│   └── styles.css     # Dark theme styles
├── server/        # FastAPI TTS API
│   ├── main.py        # Routes, per-request TTS synthesis
│   └── requirements.txt
├── vite.config.js
├── package.json
├── README.md
└── RUN_TUTORIAL.md    # Step-by-step terminal guide
```
