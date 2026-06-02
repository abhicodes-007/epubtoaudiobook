import asyncio
import io
import os
import platform
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
    """Synthesize speech using Riva TTS."""
    _load_riva()

    auth = riva_client.Auth(
        uri=RIVA_SERVER,
        use_ssl=True,
        metadata_args=[
            ("function-id", RIVA_FUNCTION_ID),
            ("authorization", f"Bearer {api_key}"),
        ],
    )
    service = riva_client.SpeechSynthesisService(auth)

    # Validate voice name
    if not voice.startswith("Magpie-Multilingual"):
        print(f"Warning: Invalid voice name '{voice}', using default")
        voice = RIVA_DEFAULT_VOICE

    response = service.synthesize(
        text=text,
        voice_name=voice,
        language_code="en-US",
        encoding=riva_client.AudioEncoding.LINEAR_PCM,
        sample_rate_hz=44100,
    )

    audio = response.audio
    if not audio:
        raise RuntimeError("Riva returned empty audio")

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
