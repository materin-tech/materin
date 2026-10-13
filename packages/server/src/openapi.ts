export function openApiSpec(): Record<string, unknown> {
  const messageRef: Record<string, unknown> = { $ref: '#/components/schemas/Message' }
  const array = (items: unknown) => ({
    schema: { type: 'array', items: items },
  })
  const okJson = (schema?: unknown) => ({
    description: 'OK',
    ...(schema ? { content: { 'application/json': schema } } : {}),
  })
  const op = (summary: string, request?: unknown, response?: unknown) => ({
    summary: summary,
    ...(request ? { requestBody: request } : {}),
    responses: { '200': response ?? okJson() },
  })
  const body = (props: Record<string, unknown>, required: string[] = []) => ({
    required: true,
    content: { 'application/json': { schema: { type: 'object', required: required, properties: props } } },
  })
  const str = { type: 'string' }
  const bool = { type: 'boolean' }

  return {
    openapi: '3.1.0',
    info: { title: 'Materin Server', version: '0.1 M2' },
    paths: {
      '/': { get: op('server info') },
      '/session': {
        get: op('list sessions'),
        post: op('create session', body({ cwd: str, model: str }), okJson()),
      },
      '/session/{id}': { get: op('get session'), delete: op('delete a session and all dependent rows') },
      '/commands': { get: op('list slash commands for autocomplete (builtins + extension commands)') },
      '/config': {
        get: op('masked config view (hasKey flags, no keys)'),
        post: op('merge provider config (apiKey/baseUrl/defaultModel), returns masked view'),
      },
      '/workspace': {
        get: op('get the active workspace (default cwd for new sessions)'),
        post: op('switch the active workspace', body({ cwd: str }, ['cwd'])),
      },
      '/fs/dirs': { get: op('list subdirectories for the workspace browser (?path= absolute dir)') },
      '/session/{id}/messages': {
        get: op('full message chain for history/export', undefined, okJson(array(messageRef))),
      },
      '/session/{id}/prompt': { post: op('queue a prompt', body({ text: str }, ['text'])) },
      '/session/{id}/branch': { post: op('branch to a historical message', body({ messageId: str }, ['messageId'])) },
      '/session/{id}/abort': { post: op('abort the running agent') },
      '/session/{id}/compact': { post: op('run compaction') },
      '/session/{id}/model': { post: op('switch model mid-session', body({ model: str }, ['model'])) },
      '/session/{id}/permission/{callId}': { post: op('answer a permission ask', body({ allow: bool }, ['allow'])) },
      '/event': { get: op('SSE event stream') },
    },
    components: {
      schemas: {
        Message: {
          type: 'object',
          properties: {
            id: str,
            parentId: str,
            role: { type: 'string', enum: ['user', 'assistant', 'toolResult'] },
            content: { type: 'array', items: { type: 'object' } },
            model: str,
            provider: str,
          },
        },
      },
    },
  }
}
