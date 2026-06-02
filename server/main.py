import asyncio
import io
import os
import platform
import time
import wave
import pathlib

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field

# Lazy import riva so the app starts even if gRPC libs are broken
riva = None
riva_client = None

def _load_riva():
    global riva, riva_client
    if riva is None:
        import riva.client as _rc
        riva = _rc
        riva_client = _rc

app = FastAPI(title="EPUB Audiobook TTS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Riva TTS Configuration
RIVA_SERVER = os.environ.get("RIVA_SERVER", "grpc.nvcf.nvidia.com:443")
RIVA_FUNCTION_ID = os.environ.get("RIVA_FUNCTION_ID", "877104f7-e885-42b9-8de8-f6e4c6303969")
RIVA_DEFAULT_VOICE = "Magpie-Multilingual.EN-US.Aria.Neutral"

# Rate limiting: cap concurrent TTS requests and add min delay between them
_tts_semaphore = asyncio.Semaphore(2)
_last_tts_time: float = 0.0
_MIN_TTS_INTERVAL: float = 0.5  # seconds between requests

# Retry configuration
_TTS_MAX_RETRIES: int = 3
_TTS_BASE_DELAY: float = 1.0  # seconds, exponential backoff

# Magpie TTS voice configuration
MAGPIE_SPEAKERS = ["Aria", "Mia", "Jason", "Leo", "Sofia", "Ray", "Pascal", "Diego"]
MAGPIE_EMOTIONS = ["Neutral", "Calm", "Angry", "Happy", "Sad", "Fearful"]
MAGPIE_LOCALE = "EN-US"


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


def _synthesize_riva(text: str, voice: str, api_key: str) -> bytes:
    """Synthesize speech using Riva TTS with retry and rate limiting."""
    _load_riva()

    # Validate voice name
    if not voice.startswith("Magpie-Multilingual"):
        print(f"Warning: Invalid voice name '{voice}', using default")
        voice = RIVA_DEFAULT_VOICE

    last_error = None
    for attempt in range(_TTS_MAX_RETRIES):
        try:
            # Rate limiting: ensure minimum interval between requests
            global _last_tts_time
            now = time.monotonic()
            elapsed = now - _last_tts_time
            if elapsed < _MIN_TTS_INTERVAL:
                time.sleep(_MIN_TTS_INTERVAL - elapsed)

            auth = riva_client.Auth(
                uri=RIVA_SERVER,
                use_ssl=True,
                metadata_args=[
                    ("function-id", RIVA_FUNCTION_ID),
                    ("authorization", f"Bearer {api_key}"),
                ],
            )
            service = riva_client.SpeechSynthesisService(auth)

            response = service.synthesize(
                text=text,
                voice_name=voice,
                language_code="en-US",
                encoding=riva_client.AudioEncoding.LINEAR_PCM,
                sample_rate_hz=44100,
            )

            _last_tts_time = time.monotonic()

            audio = response.audio
            if not audio:
                raise RuntimeError("Riva returned empty audio")

            return _pcm_to_wav(audio, sample_rate=44100)

        except Exception as e:
            last_error = e
            if attempt < _TTS_MAX_RETRIES - 1:
                delay = _TTS_BASE_DELAY * (2 ** attempt)
                print(f"Riva TTS attempt {attempt + 1} failed: {e}, retrying in {delay}s...")
                time.sleep(delay)
            else:
                print(f"Riva TTS failed after {_TTS_MAX_RETRIES} attempts: {e}")

    raise last_error or RuntimeError("Riva TTS failed after retries")


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
        "tts_backend": "nvidia-riva"
    }


@app.get("/api/config")
async def get_config():
    return {
        "riva_server": RIVA_SERVER,
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

    # Use semaphore to limit concurrent TTS requests
    async with _tts_semaphore:
        try:
            audio = await asyncio.to_thread(_synthesize_riva, text, req.voice, x_api_key)
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
