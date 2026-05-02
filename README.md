# Voice similarity (Myna take-home)

Python **FastAPI** backend and **React** (Vite + TypeScript) frontend. Reference vocals live in `reference_data/` (mono 44.1 kHz WAVs).

## Prerequisites

- Python 3.11+ recommended
- Node.js 20+ and npm

## Run locally

**1. Backend** (from repo root):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**2. Frontend** (second terminal, from repo root):

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://127.0.0.1:5173`). The UI calls the API through a dev proxy: browser requests go to `/api/*`, and Vite forwards them to `http://127.0.0.1:8000/*`.

## Layout

| Path | Role |
|------|------|
| `backend/app/main.py` | FastAPI app, CORS, health + reference listing |
| `frontend/` | Vite + React + TypeScript |
| `reference_data/` | `sample_1.wav` … `sample_10.wav` |

Next steps for the assignment: upload/compare endpoint, MFCC (or mel) pipeline, precomputed reference profiles, MediaRecorder on the frontend, tests, and README sections on approach and trade-offs.
