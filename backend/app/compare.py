"""
Compare uploaded audio against reference profiles.
"""

from __future__ import annotations

import logging
import tempfile
from collections.abc import Mapping
from pathlib import Path

import numpy as np

from app.audio_pipeline import SR, load_mono, mfcc_fingerprint

logger = logging.getLogger(__name__)

MIN_DURATION_SEC = 5.0
MAX_DURATION_SEC = 10.0
MAX_UPLOAD_BYTES = 40 * 1024 * 1024

ALLOWED_AUDIO_MEDIA_TYPES: frozenset[str] = frozenset(
    {
        "audio/webm",
        "audio/mp4",
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/aac",
        "audio/x-m4a",
        "audio/m4a",
    }
)

_MEDIA_TYPE_TO_SUFFIX: dict[str, str] = {
    "audio/webm": ".webm",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/aac": ".aac",
    "audio/x-m4a": ".m4a",
    "audio/m4a": ".m4a",
}


class CompareInputError(Exception):
    def __init__(self, message: str, code: str, status_code: int = 400) -> None:
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


def normalize_media_type(raw: str | None) -> str | None:
    if not raw:
        return None
    return raw.split(";")[0].strip().lower()


def _media_type_to_suffix(media_type: str) -> str:
    return _MEDIA_TYPE_TO_SUFFIX.get(media_type, ".bin")


def _decode_upload_to_mono(data: bytes, media_type: str) -> np.ndarray:
    """
    Write bytes to a temp file with a sensible extension and load at SR mono.

    Requires ffmpeg (or decodable format) for webm/mp4/opus etc.
    """
    suffix = _media_type_to_suffix(media_type)
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = Path(tmp.name)
    try:
        tmp.write(data)
        tmp.close()
        y, _ = load_mono(tmp_path)
        return y
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _assert_listenable_upload(y: np.ndarray) -> None:
    """Reject empty or effectively silent recordings before fingerprinting."""
    if y.size == 0:
        raise CompareInputError(
            "no audio data detected, try again",
            "no_audio_data",
            400,
        )
    rms = float(np.sqrt(np.mean(np.square(y))))
    peak = float(np.max(np.abs(y)))
    if rms < 1e-5 and peak < 1e-4:
        raise CompareInputError(
            "no audio data detected, try again",
            "no_audio_data",
            400,
        )


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a64 = np.asarray(a, dtype=np.float64)
    b64 = np.asarray(b, dtype=np.float64)
    na = np.linalg.norm(a64)
    nb = np.linalg.norm(b64)
    if na < 1e-12 or nb < 1e-12:
        raise CompareInputError(
            "no audio data detected, try again",
            "no_audio_data",
            400,
        )
    return float(np.dot(a64, b64) / (na * nb))


def rank_references(
    query_fp: np.ndarray,
    reference_profiles: Mapping[str, np.ndarray],
) -> list[tuple[str, float]]:
    """Cosine similarity vs every reference, best match first."""
    ranked = [
        (key, cosine_similarity(query_fp, ref_fp))
        for key, ref_fp in reference_profiles.items()
    ]
    ranked.sort(key=lambda kv: kv[1], reverse=True)
    return ranked


def compare_upload_to_references(
    data: bytes,
    content_type: str | None,
    reference_profiles: Mapping[str, np.ndarray],
) -> list[tuple[str, float]]:
    """
    Decode upload to a waveform, build a normalized MFCC fingerprint, then
    cosine-similarity rank against each reference fingerprint.
    """
    if len(reference_profiles) != 10:
        raise CompareInputError(
            "reference profiles unavailable",
            "service_unavailable",
            503,
        )

    media = normalize_media_type(content_type)
    if media is None or media not in ALLOWED_AUDIO_MEDIA_TYPES:
        raise CompareInputError(
            "unsupported audio type",
            "invalid_audio_type",
            400,
        )

    if len(data) == 0:
        raise CompareInputError(
            "no audio data detected, try again",
            "no_audio_data",
            400,
        )

    if len(data) > MAX_UPLOAD_BYTES:
        raise CompareInputError("file too large", "payload_too_large", 413)

    try:
        y = _decode_upload_to_mono(data, media)
    except Exception:
        logger.exception("decode failed for media_type=%s", media)
        raise CompareInputError(
            "could not decode audio",
            "decode_failed",
            400,
        ) from None

    duration = float(len(y)) / float(SR)
    if duration < MIN_DURATION_SEC:
        raise CompareInputError(
            "recording must be at least 5 seconds",
            "duration_too_short",
            400,
        )
    if duration > MAX_DURATION_SEC:
        raise CompareInputError(
            "recording must be at most 10 seconds",
            "duration_too_long",
            400,
        )

    _assert_listenable_upload(y)
    try:
        query_fp = mfcc_fingerprint(y, SR)
    except ValueError:
        raise CompareInputError(
            "no audio data detected, try again",
            "no_audio_data",
            400,
        ) from None

    return rank_references(query_fp, reference_profiles)
