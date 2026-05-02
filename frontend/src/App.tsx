import { useEffect, useState } from 'react'
import './App.css'

type HealthResponse = {
  status: string
  reference_dir: string
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<HealthResponse>
      })
      .then(setHealth)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
  }, [])

  return (
    <main className="app">
      <h1>Voice similarity</h1>
      <p className="lede">
        Myna take-home: browser recording, feature comparison, and results UI
        will live here.
      </p>
      <section className="panel" aria-labelledby="backend-status">
        <h2 id="backend-status">Backend</h2>
        {error != null && (
          <p className="error" role="alert">
            Could not reach API (start FastAPI on port 8000): {error}
          </p>
        )}
        {health != null && (
          <pre className="json">{JSON.stringify(health, null, 2)}</pre>
        )}
      </section>
    </main>
  )
}
