"""Unit tests for compare math and small helpers (no I/O)."""

import numpy as np
import pytest

from app.compare import (
    cosine_similarity,
    normalize_media_type,
    rank_references,
)


def test_cosine_similarity_parallel_unit_vectors() -> None:
    a = np.array([1.0, 0.0, 0.0], dtype=np.float64)
    b = np.array([1.0, 0.0, 0.0], dtype=np.float64)
    assert cosine_similarity(a, b) == pytest.approx(1.0)


def test_cosine_similarity_opposite() -> None:
    a = np.array([1.0, 0.0], dtype=np.float64)
    b = np.array([-1.0, 0.0], dtype=np.float64)
    assert cosine_similarity(a, b) == pytest.approx(-1.0)


def test_cosine_similarity_orthogonal() -> None:
    a = np.array([1.0, 0.0], dtype=np.float64)
    b = np.array([0.0, 1.0], dtype=np.float64)
    assert cosine_similarity(a, b) == pytest.approx(0.0)


def test_rank_references_descending() -> None:
    q = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    refs = {
        "low": np.array([0.0, 1.0, 0.0], dtype=np.float32),
        "high": np.array([1.0, 0.0, 0.0], dtype=np.float32),
        "mid": np.array([0.70710677, 0.70710677, 0.0], dtype=np.float32),
    }
    ranked = rank_references(q, refs)
    keys = [k for k, _ in ranked]
    scores = [s for _, s in ranked]
    assert keys == ["high", "mid", "low"]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("audio/wav", "audio/wav"),
        ("Audio/WAV", "audio/wav"),
        ("audio/webm; codecs=opus", "audio/webm"),
        (None, None),
        ("", None),
    ],
)
def test_normalize_media_type(raw: str | None, expected: str | None) -> None:
    assert normalize_media_type(raw) == expected
