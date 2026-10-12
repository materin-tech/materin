/** Small JSON API helper for the Materin web app. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? res.statusText)
  return body as T
}

export const json = { 'content-type': 'application/json' }
