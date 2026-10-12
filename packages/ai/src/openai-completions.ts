import { getModel } from './compat'
import { openaiThinkingParams, normalizeThinking } from './thinking'
import { mapMessages } from './openai-mapping'
import { parseOpenAiSse } from './openai-sse'
import type { Provider, StreamContext, StreamEvent } from './types'

/**
 * OpenAI Chat Completions wire-API provider (M2).
 * Covers deepseek / qwen / kimi / zai and any OpenAI-compatible endpoint.
 */

interface ToolAccum {
  id: string
  name: string
  args: string
  index: number
}

export function createOpenAIProvider(): Provider {
  async function* stream(ctx: StreamContext): AsyncIterable<StreamEvent> {
    const info = getModel(ctx.model)
    const apiKey = process.env[info.apiKeyEnv]
    if (!apiKey) {
      const err = new Error(info.apiKeyEnv + ' is not set')
      yield { type: 'error', error: err }
      return
    }

    const body = buildRequestBody(ctx, openaiThinkingParams(normalizeThinking(ctx.thinkingLevel), info.compat))

    let res: Response
    try {
      const url = info.baseUrl.replace(/\/$/, '') + '/chat/completions'
      res = await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctx.signal,
      })
    } catch (e) {
      if (isAbort(e)) return
      const err = e instanceof Error ? e : new Error(String(e))
      yield { type: 'error', error: err }
      return
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      const err = new Error('openai-completions ' + res.status + ': ' + text.slice(0, 2000))
      yield { type: 'error', error: err }
      return
    }
    yield* parseOpenAiSse(res.body)
  }

  return { stream }
}

function buildRequestBody(ctx: StreamContext, extraParams: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: ctx.model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: ctx.maxTokens ?? 8192,
    messages: mapMessages(ctx.systemPrompt, ctx.messages),
  }
  Object.assign(body, extraParams)
  if (ctx.tools.length > 0) {
    body.tools = ctx.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  }
  return body
}


function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
}
