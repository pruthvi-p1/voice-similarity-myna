"""MFCC-based voice fingerprints pipeline"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import numpy as np
import librosa

SR = 44100


def load_mono(path: Path | str) -> tuple[np.ndarray, int]:
    """Load audio"""
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y.astype(np.float32), SR


def mfcc_fingerprint(y: np.ndarray, sr: int = SR) -> np.ndarray:
    """
    Time-aggregated MFCC vector for comparison.
    """
    if y.size == 0:
        raise ValueError("Bad Waveform Data")

    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    # Mean MFCC over frames gives a fixed-length descriptor regardless of audio length.
    vec = np.mean(mfcc, axis=1).astype(np.float64)
    # Normalize the vector
    norm = np.linalg.norm(vec)
    return (vec / norm).astype(np.float32)


def fingerprint_from_wav(path: Path | str) -> np.ndarray:
    y, sr = load_mono(path)
    return mfcc_fingerprint(y, sr)
