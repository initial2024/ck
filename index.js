import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
export const name = 'dsh-web-relay-toolcall-compat'
export const inject = ['llm', 'tools', 'agents']

const CALL_PREFIX = '助手请求调用工具（'
const RETURN_PREFIX = '工具返回（'
const CALL_LINE = /^助手请求调用工具（name=([^,（）\s]+),\s*id=([^（）\s]+)）：\s*(\{.*\})$/u
const TOOL_CALLS_OPEN = '<tool_calls>'
const TOOL_CALLS_CLOSE = '</tool_calls>'
const FEEDBACK_TOOL = 'web_relay_compat_feedback'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function visibleToolSchemas(options, registeredSchemas = []) {
  const schemas = new Map()
  for (const tool of registeredSchemas) {
    const name = tool?.name
    if (typeof name === 'string' && name.length > 0) schemas.set(name, tool)
  }
  if (!Array.isArray(options?.tools)) return schemas
  for (const tool of options.tools) {
    const name = tool?.name
    if (typeof name === 'string' && name.length > 0) schemas.set(name, tool)
  }
  return schemas
}

function registryVisibleToolSchemas(ctx, options) {
  let agent
  try {
    if (options?.sessionId !== undefined) agent = ctx.agents.get(options.sessionId)
  } catch {
    agent = undefined
  }
  try {
    return ctx.tools.schemas(agent)
  } catch {
    return []
  }
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
  if (isPlainObject(value)) return { value, json: JSON.stringify(value) }
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return isPlainObject(parsed) ? { value: parsed, json: JSON.stringify(parsed) } : null
  } catch {
    return null
  }
}

function validateCalls(rawCalls, options, registeredSchemas = []) {
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return null
  const allowed = visibleToolSchemas(options, registeredSchemas)
  const ids = new Set()
  const calls = []
  const skipped = []
  for (let index = 0; index < rawCalls.length; index += 1) {
    const item = rawCalls[index]
    if (!isPlainObject(item)) {
      skipped.push({ index, name: '(invalid)', reason: 'call_not_object' })
      continue
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) {
      skipped.push({ index, name: '(missing)', reason: 'missing_tool_name' })
      continue
    }
    if (name === FEEDBACK_TOOL) {
      skipped.push({ index, name, reason: 'reserved_internal_tool' })
      continue
    }
    const toolSchema = allowed.get(name)
    if (toolSchema === undefined) {
      skipped.push({ index, name, reason: 'tool_not_available' })
      continue
    }
    const normalized = normalizeArguments(item.arguments)
    if (normalized === null) {
      skipped.push({ index, name, reason: 'arguments_not_object' })
      continue
    }
    const parameterSchema = toolSchema.parameters
    if (parameterSchema !== undefined) {
      let violations
      try {
        violations = validateJsonSchemaValue(parameterSchema, normalized.value, 'arguments')
      } catch (error) {
        skipped.push({ index, name, reason: 'schema_validation_unavailable', detail: String(error?.message || error) })
        continue
      }
      if (violations.length > 0) {
        skipped.push({ index, name, reason: 'schema_validation_failed', detail: violations.slice(0, 3).join('; ') })
        continue
      }
    }
    const argumentsJson = normalized.json
    const id = item.id === undefined ? stableId(name, argumentsJson, index) : item.id
    if (typeof id !== 'string' || id.length === 0) {
      skipped.push({ index, name, reason: 'invalid_call_id' })
      continue
    }
    if (ids.has(id)) {
      skipped.push({ index, name, reason: 'duplicate_call_id' })
      continue
    }
    ids.add(id)
    calls.push({
      name,
      id,
      arguments: argumentsJson,
      sourceIndex: index,
      streamIndex: Number.isInteger(item.streamIndex) ? item.streamIndex : undefined,
    })
  }
  return { calls, skipped }
}

function feedbackCall(skipped) {
  if (!Array.isArray(skipped) || skipped.length === 0) return null
  const argumentsJson = JSON.stringify({ skipped })
  return {
    name: FEEDBACK_TOOL,
    id: stableId(FEEDBACK_TOOL, argumentsJson, 999999),
    arguments: argumentsJson,
  }
}
function parseLegacyToolCalls(text, options, registeredSchemas = []) {
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
  const validated = validateCalls(rawCalls, options, registeredSchemas)
  return validated === null ? null : { ...validated, prose: '' }
}

function stripJsonFence(value) {
  const trimmed = value.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match ? match[1] : trimmed
}

function parseTaggedToolCalls(text, options, registeredSchemas = []) {
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
  const validated = validateCalls(rawCalls, options, registeredSchemas)
  if (validated === null) return null

  const before = text.slice(0, open).trim()
  const after = text.slice(close + TOOL_CALLS_CLOSE.length).trim()
  const prose = [before, after].filter(Boolean).join('\n\n')
  return { ...validated, prose }
}

function parseToolCallText(text, options, registeredSchemas = []) {
  return parseLegacyToolCalls(text, options, registeredSchemas)
    ?? parseTaggedToolCalls(text, options, registeredSchemas)
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

function normalizedCallKey(call) {
  let args = call?.arguments
  try {
    args = typeof args === 'string' ? JSON.parse(args) : args
    if (isPlainObject(args)) {
      const ordered = {}
      for (const key of Object.keys(args).sort()) ordered[key] = args[key]
      args = ordered
    }
  } catch {}
  return String(call?.name || '') + '\n' + JSON.stringify(args)
}

function collectNativeToolCalls(chunks) {
  const rawCalls = []
  for (const chunk of chunks) {
    if (chunk?.type !== 'block-end' || chunk.block?.type !== 'tool-call') continue
    rawCalls.push({
      name: chunk.block.name,
      id: chunk.block.id,
      arguments: chunk.block.arguments,
      streamIndex: chunk.index,
    })
  }
  return rawCalls
}

function isNativeToolChunk(chunk) {
  return chunk?.type === 'tool-call-delta'
    || (chunk?.type === 'block-start' && chunk.blockType === 'tool-call')
    || (chunk?.type === 'block-end' && chunk.block?.type === 'tool-call')
}

function transformNativeToolCalls(chunks, options, registeredSchemas = []) {
  const rawCalls = collectNativeToolCalls(chunks)
  if (rawCalls.length === 0) return chunks

  const validated = validateCalls(rawCalls, options, registeredSchemas)
  if (validated === null || validated.skipped.length === 0) return chunks

  const acceptedStreamIndexes = new Set(
    validated.calls
      .map(call => call.streamIndex)
      .filter(Number.isInteger),
  )

  const out = []
  const usage = []
  for (const chunk of chunks) {
    if (chunk?.type === 'finish') continue
    if (isUsageChunk(chunk)) {
      usage.push(chunk)
      continue
    }
    if (isNativeToolChunk(chunk) && !acceptedStreamIndexes.has(chunk.index)) continue
    out.push(chunk)
  }

  const feedback = feedbackCall(validated.skipped)
  let index = maxBlockIndex(out) + 1
  if (feedback !== null) {
    out.push({ type: 'block-start', index, blockType: 'tool-call' })
    out.push({ type: 'tool-call-delta', index, id: feedback.id, name: feedback.name, argumentsDelta: feedback.arguments })
    out.push({ type: 'block-end', index, block: { type: 'tool-call', id: feedback.id, name: feedback.name, arguments: feedback.arguments } })
  }

  out.push(...usage)
  out.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return out
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

function transform(chunks, options, registeredSchemas = []) {
  const nativePresent = hasNativeToolCall(chunks)
  const text = collectCompletedText(chunks)
  const finish = terminalFinish(chunks)

  if (nativePresent && (text === null || !text.includes(TOOL_CALLS_OPEN))) {
    return transformNativeToolCalls(chunks, options, registeredSchemas)
  }

  if (!finish || !['stop', 'tool-calls'].includes(finish.reason?.kind)) return chunks
  if (text === null) return chunks

  const parsed = parseToolCallText(text, options, registeredSchemas)
  if (parsed === null) return chunks

  const nativeValidated = nativePresent
    ? validateCalls(collectNativeToolCalls(chunks), options, registeredSchemas)
    : null

  const acceptedNativeIndexes = new Set(
    (nativeValidated?.calls || [])
      .map(call => call.streamIndex)
      .filter(Number.isInteger),
  )
  const acceptedNativeIds = new Set((nativeValidated?.calls || []).map(call => call.id))
  const acceptedNativeKeys = new Set((nativeValidated?.calls || []).map(normalizedCallKey))

  const mergedSkipped = [...(nativeValidated?.skipped || []), ...parsed.skipped]
  const textCalls = []

  for (const call of parsed.calls) {
    if (acceptedNativeIds.has(call.id) || acceptedNativeKeys.has(normalizedCallKey(call))) {
      mergedSkipped.push({
        index: call.sourceIndex ?? -1,
        name: call.name,
        reason: 'duplicate_of_native_call',
      })
      continue
    }
    textCalls.push(call)
  }

  const out = []
  const usage = []
  for (const chunk of chunks) {
    if (isTextChunk(chunk) || chunk?.type === 'finish') continue
    if (nativePresent && isNativeToolChunk(chunk) && !acceptedNativeIndexes.has(chunk.index)) continue
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

  const executableCalls = [...textCalls]
  const feedback = feedbackCall(mergedSkipped)
  if (feedback !== null) executableCalls.push(feedback)

  for (const call of executableCalls) {
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
  ctx.tools.register({
    name: FEEDBACK_TOOL,
    description: 'Internal Web Relay compatibility feedback. Do not call this tool directly.',
    parameters: {
      type: 'object',
      properties: {
        skipped: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              name: { type: 'string' },
              reason: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['index', 'name', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['skipped'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: String(value) }] },
    },
    async execute(args) {
      const rows = Array.isArray(args?.skipped) ? args.skipped : []
      const detail = rows.map(item => `${item.name}: ${item.reason}`).join('; ')
      return `Web Relay compatibility skipped ${rows.length} tool call(s). ${detail}. Continue with the tool results that did execute, and choose another approach for skipped calls.`
    },
  })

  ctx.on('llm/stream', async function* (options, next) {
    const chunks = []
    for await (const chunk of next()) chunks.push(chunk)
    const registeredSchemas = registryVisibleToolSchemas(ctx, options)
    for (const chunk of transform(chunks, options, registeredSchemas)) yield chunk
  }, { global: true, prepend: true })
}

export const _test = {
  parseLegacyToolCalls,
  parseTaggedToolCalls,
  parseToolCallText,
  registryVisibleToolSchemas,
  feedbackCall,
  normalizedCallKey,
  collectNativeToolCalls,
  transformNativeToolCalls,
  transform,
}
