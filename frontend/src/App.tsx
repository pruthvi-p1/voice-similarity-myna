import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

type CompareSimilarity = {
  reference_id: string
  cosine_similarity: number
}

type CompareResponse = {
  similarities: CompareSimilarity[]
}

type ApiErrorDetail =
  | string
  | { message?: string; code?: string }
  | undefined

function parseApiError(status: number, body: unknown): string {
  if (
    body != null &&
    typeof body === 'object' &&
    'detail' in body &&
    (body as { detail: ApiErrorDetail }).detail != null
  ) {
    const d = (body as { detail: ApiErrorDetail }).detail
    if (typeof d === 'string') return d
    if (typeof d === 'object' && d.message) return d.message
  }
  return `Request failed (${status})`
}

const MIN_RECORD_SEC = 5
const MAX_RECORD_SEC = 10
/** Auto-stop and encode often finish slightly after 10s wall clock; keep Compare enabled. */
const DURATION_UPPER_SLACK_SEC = 0.35

function pickRecorderMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
  ]
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t
    }
  }
  return ''
}

function extensionForMime(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  if (base === 'audio/webm') return '.webm'
  if (base === 'audio/mp4') return '.m4a'
  if (base === 'audio/mpeg' || base === 'audio/mp3') return '.mp3'
  if (base === 'audio/ogg') return '.ogg'
  return '.bin'
}

export default function App() {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'ready'>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordMime, setRecordMime] = useState('')
  const [micError, setMicError] = useState<string | null>(null)

  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(null)

  const chunksRef = useRef<Blob[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const tickRef = useRef<number | null>(null)
  const recordStartedAtRef = useRef<number>(0)

  const clearTick = () => {
    if (tickRef.current != null) {
      cancelAnimationFrame(tickRef.current)
      tickRef.current = null
    }
  }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const stopRecording = useCallback(() => {
    clearTick()
    const rec = mediaRecorderRef.current
    mediaRecorderRef.current = null
    if (rec != null && rec.state !== 'inactive') {
      rec.stop()
    } else {
      stopStream()
      setPhase('idle')
    }
  }, [])

  const startRecording = async () => {
    setMicError(null)
    setCompareError(null)
    setCompareResult(null)
    setRecordedBlob(null)
    setRecordMime('')
    chunksRef.current = []

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : 'Microphone access was denied or unavailable.'
      setMicError(msg)
      return
    }

    streamRef.current = stream
    const mime = pickRecorderMimeType()
    const options = mime ? { mimeType: mime } : undefined
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, options)
    } catch {
      try {
        recorder = new MediaRecorder(stream)
      } catch (e: unknown) {
        stopStream()
        setMicError(e instanceof Error ? e.message : 'Could not start recorder.')
        return
      }
    }

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data)
    }

    recorder.onstop = () => {
      stopStream()
      const usedMime =
        recorder.mimeType ||
        mime ||
        (chunksRef.current[0]?.type ?? 'audio/webm')
      const blob = new Blob(chunksRef.current, { type: usedMime })
      const duration = (Date.now() - recordStartedAtRef.current) / 1000
      setElapsedSec(duration)
      setRecordedBlob(blob)
      setRecordMime(usedMime)
      setPhase(blob.size > 0 ? 'ready' : 'idle')
      if (blob.size === 0) {
        setMicError('No audio captured. Try again.')
      }
    }

    mediaRecorderRef.current = recorder
    recordStartedAtRef.current = Date.now()
    setElapsedSec(0)
    setPhase('recording')
    recorder.start(200)

    const tick = () => {
      const t = (Date.now() - recordStartedAtRef.current) / 1000
      setElapsedSec(t)
      if (t >= MAX_RECORD_SEC) {
        stopRecording()
        return
      }
      tickRef.current = requestAnimationFrame(tick)
    }
    tickRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => () => {
    clearTick()
    stopStream()
  }, [])

  const submitCompare = async () => {
    if (recordedBlob == null || recordedBlob.size === 0) return
    if (
      elapsedSec < MIN_RECORD_SEC ||
      elapsedSec > MAX_RECORD_SEC + DURATION_UPPER_SLACK_SEC
    ) {
      setCompareError(
        `Recording must be between ${MIN_RECORD_SEC} and ${MAX_RECORD_SEC} seconds.`,
      )
      return
    }

    setCompareLoading(true)
    setCompareError(null)
    setCompareResult(null)

    const mime = recordMime || recordedBlob.type || 'audio/webm'
    const ext = extensionForMime(mime)
    const file = new File([recordedBlob], `recording${ext}`, { type: mime })

    const formData = new FormData()
    formData.append('audio', file)

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        body: formData,
      })
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(parseApiError(res.status, body))
      }
      setCompareResult(body as CompareResponse)
    } catch (e: unknown) {
      setCompareError(e instanceof Error ? e.message : String(e))
    } finally {
      setCompareLoading(false)
    }
  }

  const discardRecording = () => {
    clearTick()
    mediaRecorderRef.current = null
    stopStream()
    setRecordedBlob(null)
    setRecordMime('')
    setElapsedSec(0)
    setPhase('idle')
    setCompareError(null)
    setCompareResult(null)
  }

  const canSubmit =
    phase === 'ready' &&
    recordedBlob != null &&
    recordedBlob.size > 0 &&
    elapsedSec >= MIN_RECORD_SEC &&
    elapsedSec <= MAX_RECORD_SEC + DURATION_UPPER_SLACK_SEC &&
    !compareLoading

  return (
    <main className="app">
      <h1>Voice Similarity</h1>
      
      <section className="panel record-panel" aria-labelledby="record-heading">
        <h2 id="record-heading"> Record yourself singing or talking, then compare your voice against our vocalists.</h2>
        <p className="hint">
          
        </p>

        {micError != null && (
          <p className="error" role="alert">
            {micError}
          </p>
        )}

        <div className="record-row">
          {phase === 'idle' && (
            <button type="button" className="btn btn-primary" onClick={startRecording}>
              Start recording
            </button>
          )}
          {phase === 'recording' && (
            <>
              <button
                type="button"
                className="btn btn-danger"
                onClick={stopRecording}
                aria-pressed="true"
              >
                Stop
              </button>
              <span className="timer" aria-live="polite">
                {elapsedSec.toFixed(1)}s / {MAX_RECORD_SEC}s
              </span>
            </>
          )}
          {phase === 'ready' && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitCompare}
                disabled={!canSubmit}
              >
                {compareLoading ? 'Comparing…' : 'Compare'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={discardRecording}>
               Re-record
              </button>
              <span className="timer">
                Clip: {elapsedSec.toFixed(1)}s
                {elapsedSec < MIN_RECORD_SEC && (
                  <span className="warn"> (need at least {MIN_RECORD_SEC}s)</span>
                )}
              </span>
            </>
          )}
        </div>

        {compareError != null && (
          <p className="error compare-error" role="alert">
            {compareError}
          </p>
        )}
      </section>

      {compareResult != null && (
        <section className="panel results-panel" aria-labelledby="results-heading">
          <h2 id="results-heading">Similarity (most to least similar)</h2>
          <ol className="rank-list">
            {compareResult.similarities.map((row, i) => (
              <li key={row.reference_id}>
                <span className="rank-num">{i + 1}.</span>
                <span className="ref-id">{row.reference_id}</span>
                <span className="score">
                  {(row.cosine_similarity * 100).toFixed(1)}% cosine
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  )
}
