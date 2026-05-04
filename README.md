# Voice similarity (Myna take-home)

Python **FastAPI** backend and **React** (Vite + TypeScript) frontend. Reference vocals live in `reference_data/`.

## Prerequisites

- **Python** 3.11+ recommended  
- **Node.js** 20+ and npm  
- **ffmpeg** on your `PATH` — required so the backend can decode **non-WAV** browser uploads (`brew install ffmpeg` on macOS).

---

## Run locally (fresh clone)

Run the API from the **`backend`** directory so paths resolve correctly.

**1. Backend**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**2. Frontend** (second terminal)

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (`http://127.0.0.1:5173`). The dev server proxies `/api/*` to `http://127.0.0.1:8000/*`, so the UI calls paths like `/api/compare` without CORS issues during development.

---

## Audio analysis: approach and decisions

| Decision | Rationale |
|----------|-----------|
| **MFCC fingerprint** | 13 MFCCs via librosa, **mean-pooled over time** so each clip maps to a single **13-D vector** regardless of duration. |
| **L2-normalize** the mean MFCC vector | Cosine similarity then matches **direction** not raw loudness. |
| **Cosine similarity** vs each reference | Dot product of unit vectors, scores in **about [−1, 1]**. API returns **raw cosine** ranking is by this score. |
| **Precompute all 10 references at startup** | Fingerprints live in memory. Uploads are not compared by rereading refrence WAVs on every request. |
| **Resample to 44.1 kHz mono** | Matches provided reference WAVs; keeps one feature space for references and uploads. |
| **Non-WAV uploads** | WAV is loaded with librosa, other allowed types go through **ffmpeg → mono 44.1 kHz WAV** then the same pipeline. |
| **No usable audio** | For silent recordings throw an error message. |

### Frontend display

- **Percent column**: **angular similarity** derived from cosine so display stays in a sensible **0–100%** band without claiming calibrated probability (see brief: percentages are **normalized UI scores**, not biometric confidence).
- **Bar length**: scaled between **min and max** displayed % **within that response** so differences among the 10 references stay visible when absolute scores sit in a narrow band.

---

## Trade-offs and shortcuts

- **No training / no embeddings** — MFCC + cosine only used as its fast to explain and test.
- **Fixed reference set** — All **10** provided samples are used as references
- **Mean MFCC only** — No deltas (Δ/ΔΔ), no variance stats across time, We could add if we needed richer fixed-length vectors.
- **CORS** — Dev origins only (`localhost` Vite ports), Would not work in production.
- **UI** - Would update the how was this calculated section to point to appropriate documentation and remove mentions of APIs.

---

## What I’d improve next


- **Calibration / sanity**: optional softmax or fixed affine map documented against a tiny labeled set.
- **Ops**: Docker or pinned **ffmpeg** in docs/CI and introduction of a deployed version.
- **UI**: Addition of dual spectrograms for users recording and most similar match.
- **Testing**: Testing was limited to using Chrome only. Testing across web browsers to confirm similar results remain similar.

---

## Tests

**Backend**

```bash
cd backend
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest
```

**Frontend**

```bash
cd frontend
npm install
npm run test
```
