import asyncio
import io
import os
import platform
import wave
import pathlib

import riva.client
import riva.client.proto.riva_audio_pb2 as ra
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

# Nvidia Riva API Configuration
RIVA_SERVER = os.environ.get("RIVA_SERVER", "grpc.nvcf.nvidia.com:443")
RIVA_FUNCTION_ID = os.environ.get("RIVA_FUNCTION_ID", "877104f7-e885-42b9-8de8-f6e4c6303969")

# Magpie TTS configuration
MAGPIE_SPEAKERS = ["Aria", "Mia", "Jason", "Leo", "Sofia", "Ray", "Pascal", "Diego"]
MAGPIE_EMOTIONS = ["Neutral", "Calm", "Angry", "Happy", "Sad", "Fearful"]
MAGPIE_LOCALE = "EN-US"
RIVA_DEFAULT_VOICE = "Magpie-Multilingual.EN-US.Aria.Neutral"

# Generate all Magpie voice combinations
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

def get_tts_service(api_key: str):
    if not api_key:
        return None
    try:
        auth = riva.client.Auth(
            uri=RIVA_SERVER,
            use_ssl=True,
            metadata_args=[
                ["function-id", RIVA_FUNCTION_ID],
                ["authorization", f"Bearer {api_key}"]
            ]
        )
        return riva.client.SpeechSynthesisService(auth)
    except Exception as e:
        print(f"Warning: Failed to initialize Riva client: {e}")
        return None


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    voice: str = RIVA_DEFAULT_VOICE


def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 44100, channels: int = 1, sample_width: int = 2) -> bytes:
    """Convert raw PCM data to WAV format."""
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    return buffer.getvalue()


def _synthesize_riva(text: str, voice: str, api_key: str) -> bytes:
    """Synthesize speech using Nvidia Riva API with Magpie TTS."""
    tts_service = get_tts_service(api_key)
    if not tts_service:
        raise RuntimeError("Riva TTS service not initialized or API key missing")
    
    try:
        # Validate and normalize voice name
        if not voice.startswith("Magpie-Multilingual"):
            print(f"Warning: Invalid voice name '{voice}', using default")
            voice = RIVA_DEFAULT_VOICE
        
        response = tts_service.synthesize(
            text=text,
            voice_name=voice,
            language_code="en-US",
            encoding=ra.LINEAR_PCM,
            sample_rate_hz=44100
        )
        
        if not response.audio:
            raise RuntimeError("Riva returned empty audio")
        
        # Convert PCM to WAV format with proper headers
        return _pcm_to_wav(response.audio, sample_rate=44100)
        
    except Exception as e:
        raise RuntimeError(f"Riva TTS failed: {str(e)}")


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
        "riva_function_id": RIVA_FUNCTION_ID
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
            detail=f"Riva TTS unavailable: {str(e)}"
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
