/** 瞬时 JSON API 调用 (交互路径禁止持有流式 fetch — Bun stdin 饿死 bug). */

export async function apiPost(base: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('API ' + path + ' -> ' + String(res.status))
  return res.json()
}
