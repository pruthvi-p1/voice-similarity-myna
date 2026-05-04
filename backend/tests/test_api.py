"""HTTP smoke tests for the FastAPI app (uses real reference_data if present)."""

import io

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import app


def _make_valid_wav_bytes(duration_sec: float = 5.1) -> bytes:
    """Mono WAV with enough energy to pass RMS gate; duration within compare limits."""
    n = int(44100 * duration_sec)
    rng = np.random.default_rng(42)
    y = (0.15 * rng.standard_normal(n)).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, y, 44100, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


def test_health_ok(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_compare_rejects_empty_upload(client: TestClient) -> None:
    r = client.post(
        "/compare",
        files={"audio": ("empty.wav", b"", "audio/wav")},
    )
    assert r.status_code == 400


def test_compare_accepts_short_wav_when_profiles_loaded(client: TestClient) -> None:
    preload = client.get("/preload-status").json()
    if not preload.get("Sample Data loaded"):
        pytest.skip("reference profiles not loaded (missing reference_data?)")

    data = _make_valid_wav_bytes(5.1)
    r = client.post(
        "/compare",
        files={"audio": ("clip.wav", data, "audio/wav")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "similarities" in body
    assert len(body["similarities"]) == 10
    scores = [row["cosine_similarity"] for row in body["similarities"]]
    assert scores == sorted(scores, reverse=True)
