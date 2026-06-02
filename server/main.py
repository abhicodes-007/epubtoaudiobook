import asyncio
import io
import os
import platform
import wave
import pathlib
import httpx

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field

app = FastAPI(title="EPUB Audiobook TTS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Nvidia NIM API Configuration
NIM_TTS_URL = os.environ.get(
    "NIM_TTS_URL",
    "https://integrate.api.nvidia.com/v1/tts"
)

# Magpie TTS configuration
MAGPIE_SPEAKERS = ["Aria", "Mia", "Jason", "Leo", "Sofia", "Ray", "Pascal", "Diego"]
MAGPIE_EMOTIONS = ["Neutral", "Calm", "Angry", "Happy", "Sad", "Fearful"]
MAGPIE_LOCALE = "EN-US"
RIVA_DEFAULT_VOICE = "Magpie-Multilingual.EN-US.Aria.Neutral"


def get_magpie_voices():
    voices = []
    for speaker in MAGPIE_SPEAKERS:
        for emotion in MAGPIE_EMOTIONS:
            voice_name = f"Magpie-Multilingual.{MAGPIE_LOCALE}.{speaker}.{emotion}"
            voices.append({
                "name": voice_name,
                "locale": MAGPIE_LOCALE.replace("-", " "),
                "speaker": speaker,
                "emotion": emotion,
                "friendlyName": f"{speaker} - {emotion}"
            })
    return voices


def _synthesize_nim(text: str, voice: str, api_key: str) -> bytes:
    """Synthesize speech using NVIDIA NIM REST API (no gRPC needed)."""
    if not api_key:
        raise RuntimeError("API key is required")

    # Validate voice name
    if not voice.startswith("Magpie-Multilingual"):
        print(f"Warning: Invalid voice name '{voice}', using default")
        voice = RIVA_DEFAULT_VOICE

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "audio/wav",
    }
    payload = {
        "model": "nvidia/magpie-tts-multilingual",
        "input": text,
        "voice": voice,
        "response_format": "wav",
        "sample_rate": 44100,
    }

    # Use a fresh client per request to avoid connection pool issues
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(NIM_TTS_URL, json=payload, headers=headers)

    if resp.status_code != 200:
        detail = resp.text[:500] if resp.text else f"HTTP {resp.status_code}"
        raise RuntimeError(f"NIM API error ({resp.status_code}): {detail}")

    content_type = resp.headers.get("content-type", "")
    if "json" in content_type:
        # NIM may return JSON error even with 200
        import json
        try:
            body = resp.json()
            if "detail" in body or "error" in body:
                raise RuntimeError(f"NIM API: {body.get('detail', body.get('error', str(body)))}")
        except (json.JSONDecodeError, ValueError):
            pass

    audio = resp.content
    if len(audio) < 400:
        raise RuntimeError(f"NIM returned too few bytes ({len(audio)}): {audio[:200]}")

    # If already WAV (starts with RIFF), return directly
    if audio[:4] == b"RIFF":
        return audio

    # Otherwise treat as raw PCM and wrap in WAV
    return _pcm_to_wav(audio, sample_rate=44100)


def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 44100, channels: int = 1, sample_width: int = 2) -> bytes:
    """Convert raw PCM data to WAV format."""
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    return buffer.getvalue()


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    voice: str = RIVA_DEFAULT_VOICE


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "platform": platform.system(),
        "tts_backend": "nvidia-nim"
    }


@app.get("/api/config")
async def get_config():
    return {
        "nim_tts_url": NIM_TTS_URL,
    }


@app.get("/api/voices")
async def list_voices():
    """List available Magpie TTS voices with all emotion variants."""
    return {"voices": get_magpie_voices()}


@app.post("/api/tts")
async def synthesize(req: TTSRequest, x_api_key: str = Header(..., alias="X-API-Key")):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    try:
        audio = await asyncio.to_thread(_synthesize_nim, text, req.voice, x_api_key)
        return Response(content=audio, media_type="audio/wav")
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"TTS unavailable: {str(e)}"
        )


# --- Serve the Vite frontend build (production) ---

STATIC_DIR = pathlib.Path(__file__).resolve().parent.parent / "dist"

if STATIC_DIR.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Catch-all: serve static files, fall back to index.html for SPA routing."""
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))
