/**
 * 模型注册表 + compat 标志表 (pi-ai 范式).
 * 国产 OpenAI-compatible 生态的碎片化用 compat 标志驯服.
 */

export type ThinkingFormat =
  | 'openai'          // reasoning_effort 参数
  | 'deepseek'        // reasoning_content 响应字段
  | 'qwen'            // enable_thinking 参数
  | 'zai'             // thinking.type/budget
  | 'kimi'            // temperature 控制

export interface CompatFlags {
  /** 用 max_completion_tokens 而非 max_tokens (o1+ 要求) */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  /** 思考控制的编码方式 */
  thinkingFormat?: ThinkingFormat
  /** streaming 末尾才返回 usage */
  usageInFinalChunk?: boolean
  /** 不支持 store 参数 */
  noStore?: boolean
  /** 响应里 thinking 的字段名 */
  reasoningField?: 'reasoning_content' | 'reasoning'
}

export interface ModelInfo {
  /** wire API: 'anthropic' | 'openai-completions' */
  api: 'anthropic' | 'openai-completions'
  /** 使用的 env key 名 */
  apiKeyEnv: string
  baseUrl: string
  contextWindow: number
  compat?: CompatFlags
}

const ANTHROPIC_BASE = 'https://api.anthropic.com'
const DEFAULT_ANTHROPIC: Omit<ModelInfo, 'contextWindow'> = {
  api: 'anthropic',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  baseUrl: process.env.ANTHROPIC_BASE_URL ?? ANTHROPIC_BASE,
}

/** tier alias -> canonical model id (Claude Code 风格短名). */
const ALIASES: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
  deepseek: 'deepseek-chat',
  'deepseek-r1': 'deepseek-reasoner',
  qwen: 'qwen-plus',
  kimi: 'kimi-k2',
  glm: 'glm-4.7',
}

/** 注册表: model id -> 描述. 新增 provider = 加一行配置. */
const REGISTRY: Record<string, ModelInfo> = {
  // Anthropic
  'claude-sonnet-5-5': { ...DEFAULT_ANTHROPIC, contextWindow: 200_000 },
  'claude-opus-5-5': { ...DEFAULT_ANTHROPIC, contextWindow: 200_000 },
  'claude-haiku-4-5': { ...DEFAULT_ANTHROPIC, contextWindow: 200_000 },
  // DeepSeek
  'deepseek-chat': {
    api: 'openai-completions', apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', contextWindow: 64_000,
    compat: { thinkingFormat: 'deepseek', reasoningField: 'reasoning_content' },
  },
  'deepseek-reasoner': {
    api: 'openai-completions', apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', contextWindow: 64_000,
    compat: { thinkingFormat: 'deepseek', reasoningField: 'reasoning_content' },
  },
  // Qwen (DashScope OpenAI-compatible 端点)
  'qwen-max': {
    api: 'openai-completions', apiKeyEnv: 'DASHSCOPE_API_KEY',
    baseUrl: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1', contextWindow: 32_000,
    compat: { thinkingFormat: 'qwen' },
  },
  'qwen-plus': {
    api: 'openai-completions', apiKeyEnv: 'DASHSCOPE_API_KEY',
    baseUrl: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1', contextWindow: 128_000,
    compat: { thinkingFormat: 'qwen' },
  },
  // Kimi (Moonshot)
  'kimi-k2': {
    api: 'openai-completions', apiKeyEnv: 'MOONSHOT_API_KEY',
    baseUrl: process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.cn/v1', contextWindow: 128_000,
    compat: { thinkingFormat: 'kimi' },
  },
  // 智谱 GLM
  'glm-4.7': {
    api: 'openai-completions', apiKeyEnv: 'ZAI_API_KEY',
    baseUrl: process.env.ZAI_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4', contextWindow: 128_000,
    compat: { thinkingFormat: 'zai' },
  },
}

export interface ResolvedModel {
  id: string
  info: ModelInfo
}

/** Resolve an alias chain (bounded depth so a cyclic alias can't hang). */
function resolveAlias(model: string): string {
  let current = model
  for (let depth = 0; depth < 4; depth++) {
    const next = ALIASES[current]
    if (!next) return current
    current = next
  }
  return current
}

/** Canonical id + info: exact registry hit -> alias chain -> raw input (fallback path). */
export function resolveModel(model: string): ResolvedModel {
  const raw = model.trim()
  if (REGISTRY[raw]) return { id: raw, info: REGISTRY[raw]! }
  const canonical = resolveAlias(raw)
  if (REGISTRY[canonical]) return { id: canonical, info: REGISTRY[canonical]! }
  return { id: raw, info: fallbackInfo(raw) }
}

/** 未知模型: 按前缀猜, 兜底 openai-completions + OPENAI_API_KEY */
function fallbackInfo(model: string): ModelInfo {
  if (model.startsWith('claude')) return { ...DEFAULT_ANTHROPIC, contextWindow: 200_000 }
  return {
    api: 'openai-completions',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    contextWindow: 128_000,
    compat: { thinkingFormat: 'openai' },
  }
}

export function getModel(model: string): ModelInfo {
  return resolveModel(model).info
}

export function listModels(): string[] {
  return Object.keys(REGISTRY)
}

export interface AvailableModel {
  id: string
  api: ModelInfo['api']
  contextWindow: number
  configured: boolean
}

/** Registry listing with per-model configuration status (env key present). */
export function listAvailableModels(): AvailableModel[] {
  return Object.entries(REGISTRY).map(([id, info]) => ({
    id: id,
    api: info.api,
    contextWindow: info.contextWindow,
    configured: Boolean(process.env[info.apiKeyEnv]),
  }))
}
