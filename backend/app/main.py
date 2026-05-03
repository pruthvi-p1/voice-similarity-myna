"""FastAPI backend for voice similarity"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.compare import CompareInputError, compare_upload_to_references
from app.reference_profiles import build_reference_profiles
from app.schemas_compare import CompareResponse, SimilarityRow

REFERENCE_DATA = Path("../reference_data")


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Precompute MFCC fingerprints for all reference vocalists once at startup."""
    app.state.reference_profiles = build_reference_profiles(REFERENCE_DATA)
    logger.info(
        "loaded %d reference fingerprints from %s",
        len(app.state.reference_profiles),
        REFERENCE_DATA,
    )
    yield


app = FastAPI(title="Voice Similarity API", version="0.1.0", lifespan=lifespan)

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

@app.get("/preload-status")
def preload_status():
    profiles = getattr(app.state, "reference_profiles", None)
    return {
        "Sample Data loaded": profiles is not None,
        "Sample Data count": len(profiles) if profiles else 0,
    }


@app.post("/compare", response_model=CompareResponse)
async def compare(request: Request, audio: UploadFile = File(...)):
    """
    Compare MFCC fingerprint of users audio against all reference vocalists.
    """
    profiles = getattr(request.app.state, "reference_profiles", None)
    if not profiles:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "reference profiles unavailable",
                "code": "service_unavailable",
            },
        )

    data = await audio.read()
    try:
        ranked = compare_upload_to_references(data, audio.content_type, profiles)
    except CompareInputError as e:
        raise HTTPException(
            status_code=e.status_code,
            detail={"message": e.message, "code": e.code},
        ) from e

    return CompareResponse(
        similarities=[
            SimilarityRow(reference_id=k, cosine_similarity=s) for k, s in ranked
        ]
    )