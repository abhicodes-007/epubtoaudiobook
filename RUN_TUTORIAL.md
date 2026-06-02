# How to Run EPUB → Audiobook (Terminal Tutorial)

A step-by-step guide to get the app running from scratch in your terminal.

---

## Prerequisites

Make sure you have these installed:

```bash
# Check Node.js (v18+)
node --version

# Check Python (3.10+)
python3 --version

# Check npm
npm --version
```

If you don't have them:
- **Node.js**: https://nodejs.org
- **Python**: https://python.org or `brew install python@3.11`

---

## Step 1 — Clone & Enter the Project

```bash
git clone <your-repo-url> 9routerapi
cd 9routerapi/epubtoaudiobook
```

Or if you already have the folder:
```bash
cd ~/Desktop/9routerapi/epubtoaudiobook
```

---

## Step 2 — Set Up the Python Backend

### Create a virtual environment
```bash
python3 -m venv .venv
```

### Activate it
```bash
# macOS / Linux
source .venv/bin/activate

# Windows (PowerShell)
.venv\Scripts\Activate.ps1

# Windows (cmd)
.venv\Scripts\activate.bat
```

### Install Python dependencies
```bash
pip install -r server/requirements.txt
```

### Start the backend server
```bash
uvicorn server.main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

> **Keep this terminal tab open!** The backend needs to stay running.

---

## Step 3 — Set Up the Frontend

Open a **new terminal tab** (don't close the backend tab).

### Navigate to the project root
```bash
cd ~/Desktop/9routerapi/epubtoaudiobook
```

### Install Node.js dependencies
```bash
npm install
```

### Start the frontend dev server
```bash
npm run dev
```

You should see:
```
  VITE v6.4.2  ready in 200 ms

  ➜  Local:   http://localhost:5173/
```

> **Keep this terminal tab open too!** Both servers must run simultaneously.

---

## Step 4 — Get Your NVIDIA API Key

1. Go to https://build.nvidia.com/nvidia/magpie-tts-multilingual
2. Sign in / create an NVIDIA account
3. Click **"Get API Key"** on the page
4. Copy the key (starts with `nvapi-...`)

---

## Step 5 — Open the App & Configure

1. Open **http://localhost:5173** in your browser
2. You'll see an **API Key input** in the header bar
3. Paste your NVIDIA API key into the field
4. Click **"Save Key"** (or press Enter)
5. The status pill should turn green

---

## Step 6 — Use the App

1. Click **"Choose File"** and upload an `.epub` file
2. Use the **chapter dropdown** in the sidebar to pick a chapter
3. Click **Play ▶** to start listening
4. Click any sentence to jump to it
5. Adjust speed with the slider in the player bar

---

## Quick Reference — All Commands

Here's everything in one copy-paste block for each terminal:

### Terminal 1: Backend
```bash
cd ~/Desktop/9routerapi/epubtoaudiobook
source .venv/bin/activate
uvicorn server.main:app --reload --port 8000
```

### Terminal 2: Frontend
```bash
cd ~/Desktop/9routerapi/epubtoaudiobook
npm run dev
```

Then open **http://localhost:5173** in your browser.

---

## Stopping the Servers

In each terminal tab, press **Ctrl + C** to stop the servers.

---

## Troubleshooting

### "command not found: uvicorn"
You forgot to activate the virtual environment:
```bash
source .venv/bin/activate
```

### "Port 8000 already in use"
Another process is using port 8000. Kill it:
```bash
lsof -ti :8000 | xargs kill -9
```

### "Port 5173 already in use"
```bash
lsof -ti :5173 | xargs kill -9
```

### Backend health check
To verify the backend is running:
```bash
curl http://localhost:8000/api/health
```
Should return: `{"ok":true,...}`

### "No module named 'fastapi'"
Reinstall dependencies:
```bash
source .venv/bin/activate
pip install -r server/requirements.txt
```

### Vite shows "proxy error"
Make sure the backend is running and listening on port 8000. Check `vite.config.js` — the proxy target should be `http://127.0.0.1:8000`.

---

## Project Structure

```
epubtoaudiobook/
├── src/                 # Frontend (Vite + vanilla JS)
│   ├── main.js          # App entry, UI logic
│   ├── tts.js           # TTS API calls + localStorage
│   └── styles.css       # Dark theme styles
├── server/              # Backend (FastAPI)
│   ├── main.py          # API routes, TTS synthesis
│   └── requirements.txt # Python dependencies
├── index.html           # HTML shell
├── vite.config.js       # Vite config + API proxy
├── package.json         # Node.js dependencies
└── README.md            # Project overview
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/config` | Check if server has an API key |
| GET | `/api/voices` | List available TTS voices |
| POST | `/api/tts` | Synthesize text → audio (send `X-API-Key` header) |
| POST | `/api/tts/voices` | Synthesize voices demo |
