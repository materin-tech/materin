/**
 * Worker 线程 HTTP 源码 (字符串): 主线程零 fetch — Bun runtime bug
 * (主线程在 raw stdin 读取开始后一旦 fetch, Ink useInput 按键投递基本永久失效).
 *
 * 消息协议:
 *   收 {type:'request', id, method, path, baseUrl, body?}
 *   回 {type:'response', id, ok, status, json?} / 出错时 {type:'response', id, ok:false, status:0, error}
 * Worker 内不做任何其它 postMessage.
 */

export const WORKER_CODE: string = [
  'self.onmessage = (ev) => {',
  '  const { id, method, path, baseUrl, body } = ev.data',
  '  ;(async () => {',
  '    try {',
  '      const res = await fetch(baseUrl + path, {',
  '        method: method,',
  '        headers: { "content-type": "application/json" },',
  '        body: body === undefined ? undefined : JSON.stringify(body),',
  '      })',
  '      const ct = res.headers.get("content-type") || ""',
  '      const payload = ct.includes("application/json") ? await res.json() : await res.text()',
  '      self.postMessage({ type: "response", id: id, ok: res.ok, status: res.status, json: payload })',
  '    } catch (e) {',
  '      self.postMessage({ type: "response", id: id, ok: false, status: 0, error: String(e) })',
  '    }',
  '  })()',
  '}',
].join('\n')
