"""FastAPI backend for voice similarity"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Repo root: backend/app/main.py -> parents[2]
REPO_ROOT = Path(__file__).resolve().parents[2]
REFERENCE_DATA_DIR = REPO_ROOT / "reference_data"

app = FastAPI(title="Voice Similarity API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}