"""Precomputed reference vocalist fingerprints (built once at server startup)."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from app.audio_pipeline import fingerprint_from_wav

logger = logging.getLogger(__name__)

REFERENCE_KEYS = [f"sample_{i}" for i in range(1, 11)]


def build_reference_profiles(reference_dir: Path) -> dict[str, np.ndarray]:
    """
    Load sample_1.wav … sample_10.wav and compute MFCC fingerprints.

    Raises FileNotFoundError if any expected file is missing.
    """
    profiles: dict[str, np.ndarray] = {}
    for key in REFERENCE_KEYS:
        wav_path = reference_dir / f"{key}.wav"
        #print(wav_path)
        if not wav_path.is_file():
            raise FileNotFoundError(f"missing reference file: {wav_path}")
        profiles[key] = fingerprint_from_wav(wav_path)
        #print(profiles[key])
        logger.info("reference fingerprint ready: %s", key)
    return profiles
