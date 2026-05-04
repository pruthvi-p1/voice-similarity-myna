type ApiErrorDetail =
  | string
  | { message?: string; code?: string }
  | undefined

/** Parse FastAPI-style JSON error body into a single message string. */
export function parseApiError(status: number, body: unknown): string {
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
