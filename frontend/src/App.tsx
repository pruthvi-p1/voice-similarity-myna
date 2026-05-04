import { useCallback, useEffect, useId, useRef, useState } from 'react'
import './App.css'

import { parseApiError } from './lib/apiError'
import { angularSimilarityPercent, similarityBarWidthPct } from './lib/similarity'

type CompareSimilarity = {
  reference_id: string
  cosine_similarity: number
}

type CompareResponse = {
  similarities: CompareSimilarity[]
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

function getAudioContextClass(): typeof AudioContext | null {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
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
  const [showScoringHelp, setShowScoringHelp] = useState(false)
  const scoringHelpPanelId = useId()

  const chunksRef = useRef<Blob[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const tickRef = useRef<number | null>(null)
  const recordStartedAtRef = useRef<number>(0)

  const spectrogramCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const spectrogramRafRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const spectrogramActiveRef = useRef(false)

  const stopSpectrogram = useCallback(() => {
    spectrogramActiveRef.current = false
    if (spectrogramRafRef.current != null) {
      cancelAnimationFrame(spectrogramRafRef.current)
      spectrogramRafRef.current = null
    }
    analyserRef.current = null
    const ac = audioContextRef.current
    audioContextRef.current = null
    void ac?.close()

    const canvas = spectrogramCanvasRef.current
    if (canvas != null) {
      const ctx = canvas.getContext('2d')
      if (ctx != null) {
        const wrap = canvas.closest('.spectrogram-wrap')
        const bg =
          (wrap && getComputedStyle(wrap).getPropertyValue('--spectrogram-bg').trim()) ||
          '#14151a'
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [])

  const startSpectrogram = useCallback(
    (stream: MediaStream) => {
      stopSpectrogram()

      const AudioCtx = getAudioContextClass()
      const canvas = spectrogramCanvasRef.current
      if (AudioCtx == null || canvas == null) return

      const audioCtx = new AudioCtx()
      audioContextRef.current = audioCtx
      void audioCtx.resume()

      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.68
      source.connect(analyser)
      analyserRef.current = analyser

      const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
      const rect = canvas.getBoundingClientRect()
      let w = Math.max(1, Math.floor(rect.width * dpr))
      let h = Math.max(1, Math.floor(rect.height * dpr))
      if (w < 8 || h < 8) {
        w = Math.floor(640 * dpr)
        h = Math.floor(160 * dpr)
      }
      canvas.width = w
      canvas.height = h

      const g = canvas.getContext('2d')
      if (g == null) return

      const wrapEl = canvas.closest('.spectrogram-wrap')
      const bg =
        (wrapEl && getComputedStyle(wrapEl).getPropertyValue('--spectrogram-bg').trim()) ||
        '#14151a'
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)

      const freqData = new Uint8Array(analyser.frequencyBinCount)
      const stripW = Math.max(1, Math.round(dpr))

      spectrogramActiveRef.current = true

      const draw = () => {
        if (!spectrogramActiveRef.current || analyserRef.current == null) return

        const a = analyserRef.current
        a.getByteFrequencyData(freqData)
        const n = freqData.length

        g.drawImage(canvas, stripW, 0, w - stripW, h, 0, 0, w - stripW, h)

        for (let y = 0; y < h; y++) {
          const bin = Math.min(n - 1, Math.floor((1 - y / h) * n * 0.92))
          const v = freqData[bin]! / 255
          const r = Math.floor(18 + v * 210)
          const gCh = Math.floor(12 + v * 95)
          const b = Math.floor(35 + v * 210)
          g.fillStyle = `rgb(${r},${gCh},${b})`
          g.fillRect(w - stripW, y, stripW, 1)
        }

        spectrogramRafRef.current = requestAnimationFrame(draw)
      }

      spectrogramRafRef.current = requestAnimationFrame(draw)
    },
    [stopSpectrogram],
  )

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
    stopSpectrogram()
    clearTick()
    const rec = mediaRecorderRef.current
    mediaRecorderRef.current = null
    if (rec != null && rec.state !== 'inactive') {
      rec.stop()
    } else {
      stopStream()
      setPhase('idle')
    }
  }, [stopSpectrogram])

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

    queueMicrotask(() => startSpectrogram(stream))

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
    stopSpectrogram()
    clearTick()
    stopStream()
  }, [stopSpectrogram])

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
    stopSpectrogram()
    clearTick()
    mediaRecorderRef.current = null
    stopStream()
    setRecordedBlob(null)
    setRecordMime('')
    setElapsedSec(0)
    setPhase('idle')
    setCompareError(null)
    setCompareResult(null)
    setShowScoringHelp(false)
  }

  const canSubmit =
    phase === 'ready' &&
    recordedBlob != null &&
    recordedBlob.size > 0 &&
    elapsedSec >= MIN_RECORD_SEC &&
    elapsedSec <= MAX_RECORD_SEC + DURATION_UPPER_SLACK_SEC &&
    !compareLoading

  const resultSimilarityPercents =
    compareResult?.similarities.map((row) =>
      angularSimilarityPercent(row.cosine_similarity),
    ) ?? []
  const resultMinPct =
    resultSimilarityPercents.length > 0
      ? Math.min(...resultSimilarityPercents)
      : 0
  const resultMaxPct =
    resultSimilarityPercents.length > 0
      ? Math.max(...resultSimilarityPercents)
      : 0

  return (
    <main className="app">
      <h1>Voice Similarity</h1>
      
      <section className="panel record-panel" aria-labelledby="record-heading">
        <h2 id="record-heading"> Record yourself singing or talking, then compare your voice against our vocalists.</h2>

        <div className="record-row">
          {phase === 'idle' && (
            <button type="button" className="btn btn-primary" onClick={startRecording}>
              Start recording
            </button>
          )}
          {phase === 'recording' && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={stopRecording}
              aria-pressed="true"
            >
              Stop
            </button>
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
            </>
          )}
        </div>

        {(micError != null ||
          compareError != null ||
          phase === 'recording' ||
          phase === 'ready') && (
          <div className="record-status">
            {micError != null ? (
              <p className="error record-status-message" role="alert">
                {micError}
              </p>
            ) : compareError != null ? (
              <p className="error record-status-message" role="alert">
                {compareError}
              </p>
            ) : phase === 'recording' ? (
              <span className="timer" aria-live="polite">
                {elapsedSec.toFixed(1)}s / {MAX_RECORD_SEC}s
              </span>
            ) : (
              <span className="timer">
                Clip: {elapsedSec.toFixed(1)}s
                {elapsedSec < MIN_RECORD_SEC && (
                  <span className="warn"> (need at least {MIN_RECORD_SEC}s)</span>
                )}
              </span>
            )}
          </div>
        )}

        <div
          className={`spectrogram-wrap${phase === 'recording' ? ' spectrogram-wrap--active' : ''}`}
          aria-hidden={phase !== 'recording'}
        >
          <p className="spectrogram-label">Live spectrogram</p>
          <canvas
            ref={spectrogramCanvasRef}
            className="spectrogram-canvas"
            width={800}
            height={180}
            role="img"
            aria-label="Scrolling spectrogram of microphone input while recording"
          />
        </div>
      </section>

      {compareResult != null && (
        <section className="panel results-panel" aria-labelledby="results-heading">
          <h2 id="results-heading">Similarity Scores</h2>
          <table
            className="similarity-table"
            aria-labelledby="results-heading"
          >
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Reference</th>
                <th scope="col">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {compareResult.similarities.map((row, i) => {
                const pct = resultSimilarityPercents[i]
                const barWidth = similarityBarWidthPct(
                  pct,
                  resultMinPct,
                  resultMaxPct,
                )
                return (
                  <tr key={row.reference_id}>
                    <td className="rank-cell">{i + 1}</td>
                    <td className="ref-id">{row.reference_id}</td>
                    <td className="score-cell">
                      <div className="score-cell-inner">
                        <span className="score-value">{pct.toFixed(1)}%</span>
                        <div
                          className="similarity-bar-meter"
                          role="meter"
                          aria-valuemin={resultMinPct}
                          aria-valuemax={resultMaxPct}
                          aria-valuenow={pct}
                          aria-label={`${pct.toFixed(1)}% similarity (within ${resultMinPct.toFixed(1)}% to ${resultMaxPct.toFixed(1)}% for this comparison)`}
                        >
                          <div className="similarity-bar-track">
                            <div
                              className="similarity-bar-fill"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p className="footnote results-footnote">
            Wonder where the score comes from?{' '}
            <button
              type="button"
              className="link-button"
              aria-expanded={showScoringHelp}
              aria-controls={scoringHelpPanelId}
              onClick={() => setShowScoringHelp((open) => !open)}
            >
              {showScoringHelp ? 'Hide it' : 'See the gist'}
            </button>
          </p>

          {showScoringHelp && (
            <div
              id={scoringHelpPanelId}
              className="similarity-help-panel"
              role="region"
              aria-label="How compare and similarity scoring work"
            >
              <h3 className="similarity-help-heading">Quick breakdown</h3>
              <ul className="similarity-help-list">
                <li>
                  <strong>1. You hit Compare</strong> — Your file is posted to{' '}
                  <code className="inline-code">/api/compare</code> (same as the backend’s{' '}
                  <code className="inline-code">/compare</code>). That route runs the same steps on
                  your audio that it already ran on every reference file.
                </li>
                <li>
                  <strong>2. Reference files</strong> — On server start, each{' '}
                  <code className="inline-code">sample_1.wav</code> …{' '}
                  <code className="inline-code">sample_10.wav</code> is read once and stored as a
                  short list of numbers (a fingerprint). Those don’t change between requests.
                </li>
                <li>
                  <strong>3. Your audio file</strong> — It’s turned into a single-channel waveform at
                  44.1 kHz. Stuff from the browser (e.g. WebM) is converted with ffmpeg first. It has
                  to be about 5–10 seconds long; if it’s basically silent, the server says no.
                </li>
                <li>
                  <strong>4. Fingerprint</strong> — Librosa builds 13 MFCC features (a standard
                  “shape of the sound” summary), averages them across the whole clip, then divides by
                  length so every fingerprint has size 1. That way we compare tone, not volume.
                </li>
                <li>
                  <strong>5. One score per reference</strong> — Your fingerprint is compared to each
                  of the ten stored ones. Each comparison produces a single number from −1 to 1
                  (higher = more alike). That number is cosine similarity on those two lists.
                </li>
                <li>
                  <strong>6. What the table shows</strong> — The % is a display tweak on that
                  number (angular similarity). The bar is only scaled between the lowest and highest %
                  <em>in this table</em>, so you see who’s stronger or weaker among these ten, not vs
                  a perfect 100% score.
                </li>
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
