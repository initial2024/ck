export const name = 'dsh-web-relay-toolcall-compat'
export const inject = ['llm', 'tools', 'agents']

const CALL_PREFIX = '助手请求调用工具（'
const RETURN_PREFIX = '工具返回（'
const CALL_LINE = /^助手请求调用工具（name=([^,（）\s]+),\s*id=([^（）\s]+)）：\s*(\{.*\})$/u
const TOOL_CALLS_OPEN = '<tool_calls>'
const TOOL_CALLS_CLOSE = '</tool_calls>'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function visibleToolNames(options, registeredNames = []) {
  const names = new Set(registeredNames)
  if (!Array.isArray(options?.tools)) return names
  for (const tool of options.tools) {
    const name = tool?.name
    if (typeof name === 'string' && name.length > 0) names.add(name)
  }
  return names
}

function registryVisibleToolNames(ctx, options) {
  const names = new Set()
  let agent
  try {
    if (options?.sessionId !== undefined) agent = ctx.agents.get(options.sessionId)
  } catch {
    agent = undefined
  }
  try {
    for (const tool of ctx.tools.schemas(agent)) {
      const name = tool?.name
      if (typeof name === 'string' && name.length > 0) names.add(name)
    }
  } catch {
    // Registry fallback is best-effort. The request-local tool list remains authoritative when available.
  }
  return names
}

function stableId(name, argumentsJson, index) {
  let hash = 2166136261
  const text = `${name}\n${argumentsJson}\n${index}`
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `compat_${index}_${(hash >>> 0).toString(16)}`
}

function normalizeArguments(value) {
  if (isPlainObject(value)) return JSON.stringify(value)
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return isPlainObject(parsed) ? JSON.stringify(parsed) : null
  } catch {
    return null
  }
}

function validateCalls(rawCalls, options, registeredNames = []) {
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return null
  const allowed = visibleToolNames(options, registeredNames)
  if (allowed.size === 0) return null
  const ids = new Set()
  const calls = []
  for (let index = 0; index < rawCalls.length; index += 1) {
    const item = rawCalls[index]
    if (!isPlainObject(item) || typeof item.name !== 'string' || item.name.length === 0) return null
    if (!allowed.has(item.name)) return null
    const argumentsJson = normalizeArguments(item.arguments)
    if (argumentsJson === null) return null
    const id = item.id === undefined ? stableId(item.name, argumentsJson, index) : item.id
    if (typeof id !== 'string' || id.length === 0 || ids.has(id)) return null
    ids.add(id)
    calls.push({ name: item.name, id, arguments: argumentsJson })
  }
  return calls
}

function parseLegacyToolCalls(text, options, registeredNames = []) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return null
  if (lines.some(line => line.startsWith(RETURN_PREFIX))) return null
  if (lines.some(line => !line.startsWith(CALL_PREFIX))) return null

  const rawCalls = []
  for (const line of lines) {
    const match = CALL_LINE.exec(line)
    if (!match) return null
    const [, name, id, rawArguments] = match
    let argumentsValue
    try {
      argumentsValue = JSON.parse(rawArguments)
    } catch {
      return null
    }
    rawCalls.push({ name, id, arguments: argumentsValue })
  }
  const calls = validateCalls(rawCalls, options, registeredNames)
  return calls === null ? null : { calls, prose: '' }
}

function stripJsonFence(value) {
  const trimmed = value.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match ? match[1] : trimmed
}

function parseTaggedToolCalls(text, options, registeredNames = []) {
  const open = text.indexOf(TOOL_CALLS_OPEN)
  if (open === -1) return null
  const close = text.indexOf(TOOL_CALLS_CLOSE, open + TOOL_CALLS_OPEN.length)
  if (close === -1) return null
  if (text.indexOf(TOOL_CALLS_OPEN, open + TOOL_CALLS_OPEN.length) !== -1) return null
  if (text.indexOf(TOOL_CALLS_CLOSE, close + TOOL_CALLS_CLOSE.length) !== -1) return null

  const body = stripJsonFence(text.slice(open + TOOL_CALLS_OPEN.length, close))
  let rawCalls
  try {
    rawCalls = JSON.parse(body)
  } catch {
    return null
  }
  const calls = validateCalls(rawCalls, options, registeredNames)
  if (calls === null) return null

  const before = text.slice(0, open).trim()
  const after = text.slice(close + TOOL_CALLS_CLOSE.length).trim()
  const prose = [before, after].filter(Boolean).join('\n\n')
  return { calls, prose }
}

function parseToolCallText(text, options, registeredNames = []) {
  return parseLegacyToolCalls(text, options, registeredNames)
    ?? parseTaggedToolCalls(text, options, registeredNames)
}

function collectCompletedText(chunks) {
  const completed = []
  for (const chunk of chunks) {
    if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      completed.push({ index: chunk.index, text: chunk.block.text })
    }
  }
  if (completed.length === 0) return null
  completed.sort((a, b) => a.index - b.index)
  return completed.map(item => item.text).join('\n')
}

function hasNativeToolCall(chunks) {
  return chunks.some(chunk =>
    chunk?.type === 'tool-call-delta'
    || chunk?.blockType === 'tool-call'
    || (chunk?.type === 'block-end' && chunk.block?.type === 'tool-call'))
}

function terminalFinish(chunks) {
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    if (chunks[i]?.type === 'finish') return chunks[i]
  }
  return undefined
}

function isTextChunk(chunk) {
  if (!chunk || typeof chunk !== 'object') return false
  if (chunk.type === 'text-delta') return true
  if (chunk.type === 'block-start' && chunk.blockType === 'text') return true
  if (chunk.type === 'block-end' && chunk.block?.type === 'text') return true
  return false
}

function isUsageChunk(chunk) {
  return chunk?.type === 'usage'
}

function maxBlockIndex(chunks) {
  let max = -1
  for (const chunk of chunks) {
    if (Number.isInteger(chunk?.index)) max = Math.max(max, chunk.index)
  }
  return max
}

function transform(chunks, options, registeredNames = []) {
  if (hasNativeToolCall(chunks)) return chunks

  const finish = terminalFinish(chunks)
  if (!finish || finish.reason?.kind !== 'stop') return chunks

  const text = collectCompletedText(chunks)
  if (text === null) return chunks

  const parsed = parseToolCallText(text, options, registeredNames)
  if (parsed === null) return chunks

  const out = []
  const usage = []
  for (const chunk of chunks) {
    if (isTextChunk(chunk) || chunk?.type === 'finish') continue
    if (isUsageChunk(chunk)) {
      usage.push(chunk)
      continue
    }
    out.push(chunk)
  }

  let index = maxBlockIndex(out) + 1
  if (parsed.prose.length > 0) {
    out.push({ type: 'block-start', index, blockType: 'text' })
    out.push({ type: 'text-delta', index, text: parsed.prose })
    out.push({ type: 'block-end', index, block: { type: 'text', text: parsed.prose } })
    index += 1
  }
  for (const call of parsed.calls) {
    out.push({ type: 'block-start', index, blockType: 'tool-call' })
    out.push({ type: 'tool-call-delta', index, id: call.id, name: call.name, argumentsDelta: call.arguments })
    out.push({ type: 'block-end', index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments } })
    index += 1
  }
  out.push(...usage)
  out.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return out
}

export function apply(ctx) {
  ctx.on('llm/stream', async function* (options, next) {
    const chunks = []
    for await (const chunk of next()) chunks.push(chunk)
    const registeredNames = registryVisibleToolNames(ctx, options)
    for (const chunk of transform(chunks, options, registeredNames)) yield chunk
  }, { global: true, prepend: true })
}

export const _test = {
  parseLegacyToolCalls,
  parseTaggedToolCalls,
  parseToolCallText,
  registryVisibleToolNames,
  transform,
}
