"""
Compare uploaded audio against reference profiles.
"""

from __future__ import annotations

import subprocess
import tempfile
from collections.abc import Mapping
from pathlib import Path

import librosa
import numpy as np

from app.audio_pipeline import SR, load_mono, mfcc_fingerprint

MIN_DURATION_SEC = 5.0
MAX_DURATION_SEC = 10.0
# Wall-clock / encoder padding often yields ~10.0x s from the client; allow a small ceiling.
DURATION_UPPER_SLACK_SEC = 0.35
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


def _write_temp(suffix: str, data: bytes) -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    path = Path(tmp.name)
    tmp.write(data)
    tmp.close()
    return path


def _decode_upload_to_mono(data: bytes, media_type: str) -> np.ndarray:
    """WAV: load directly. Other formats: convert to mono SR Hz WAV with ffmpeg, then load."""
    if media_type in ("audio/wav", "audio/x-wav", "audio/wave"):
        in_path = _write_temp(".wav", data)
        try:
            y, _ = load_mono(in_path)
            return y
        finally:
            in_path.unlink(missing_ok=True)

    in_path = _write_temp(_media_type_to_suffix(media_type), data)
    out_path = in_path.with_suffix(".mono44100.wav")
    try:
        # ffmpeg: decode webm/mp4/… → mono WAV @ SR (librosa cannot read those formats directly).
        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(in_path),
                "-ar",
                str(SR),
                "-ac",
                "1",
                "-f",
                "wav",
                str(out_path),
            ],
            check=True,
            timeout=120,
        )
        y, _ = load_mono(out_path)
        return y
    finally:
        in_path.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)


def _assert_listenable_upload(y: np.ndarray) -> None:
    if y.size == 0:
        raise CompareInputError(
            "no audio data detected, try again",
            "no_audio_data",
            400,
        )

    rms_frames = librosa.feature.rms(y=y, frame_length=2048, hop_length=512, center=True)[
        0
    ]
    max_frame_rms = float(np.max(rms_frames)) if rms_frames.size > 0 else 0.0
    if max_frame_rms < 0.004:
        raise CompareInputError(
            "no audio data detected, try again",
            "no_audio_data",
            400,
        )


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a64 = np.asarray(a, dtype=np.float64)
    b64 = np.asarray(b, dtype=np.float64)
    return float(np.dot(a64, b64) / (np.linalg.norm(a64) * np.linalg.norm(b64)))


def rank_references(
    query_fp: np.ndarray,
    reference_profiles: Mapping[str, np.ndarray],
) -> list[tuple[str, float]]:
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

    y = _decode_upload_to_mono(data, media)

    duration = float(len(y)) / float(SR)
    if duration < MIN_DURATION_SEC:
        raise CompareInputError(
            "recording must be at least 5 seconds",
            "duration_too_short",
            400,
        )
    if duration > MAX_DURATION_SEC + DURATION_UPPER_SLACK_SEC:
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
