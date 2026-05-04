"""Tests for MFCC fingerprint normalization."""

import numpy as np
import pytest

from app.audio_pipeline import SR, mfcc_fingerprint


def test_mfcc_fingerprint_is_unit_norm() -> None:
    t = np.linspace(0.0, 1.0, 5 * SR, dtype=np.float32)
    y = 0.1 * np.sin(2.0 * np.pi * 440.0 * t).astype(np.float32)
    fp = mfcc_fingerprint(y, SR)
    assert fp.dtype == np.float32
    norm = float(np.linalg.norm(fp))
    assert norm == pytest.approx(1.0, abs=1e-5)


def test_mfcc_fingerprint_empty_raises() -> None:
    with pytest.raises(ValueError, match="Bad Waveform Data"):
        mfcc_fingerprint(np.array([], dtype=np.float32), SR)
