export const name = 'dsh-web-relay-toolcall-compat'
export const inject = ['llm']

const CALL_PREFIX = '助手请求调用工具（'
const RETURN_PREFIX = '工具返回（'
const CALL_LINE = /^助手请求调用工具（name=([^,（）\s]+),\s*id=([^（）\s]+)）：\s*(\{.*\})$/u

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function visibleToolNames(options) {
  if (!Array.isArray(options?.tools)) return new Set()
  return new Set(options.tools.map(tool => tool?.name).filter(name => typeof name === 'string' && name.length > 0))
}

function parseToolCallOnlyText(text, options) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return null
  if (lines.some(line => line.startsWith(RETURN_PREFIX))) return null
  if (lines.some(line => !line.startsWith(CALL_PREFIX))) return null

  const allowed = visibleToolNames(options)
  if (allowed.size === 0) return null

  const ids = new Set()
  const calls = []
  for (const line of lines) {
    const match = CALL_LINE.exec(line)
    if (!match) return null
    const [, toolName, id, rawArguments] = match
    if (!allowed.has(toolName)) return null
    if (ids.has(id)) return null

    let parsed
    try {
      parsed = JSON.parse(rawArguments)
    } catch {
      return null
    }
    if (!isPlainObject(parsed)) return null

    ids.add(id)
    calls.push({ name: toolName, id, arguments: rawArguments })
  }
  return calls
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

function maxNonTextBlockIndex(chunks) {
  let max = -1
  for (const chunk of chunks) {
    if (isTextChunk(chunk) || chunk?.type === 'finish') continue
    if (Number.isInteger(chunk?.index)) max = Math.max(max, chunk.index)
  }
  return max
}

function transform(chunks, options) {
  if (hasNativeToolCall(chunks)) return chunks

  const finish = terminalFinish(chunks)
  if (!finish || finish.reason?.kind !== 'stop') return chunks

  const text = collectCompletedText(chunks)
  if (text === null) return chunks

  const calls = parseToolCallOnlyText(text, options)
  if (!calls) return chunks

  const out = []
  for (const chunk of chunks) {
    if (isTextChunk(chunk) || chunk?.type === 'finish') continue
    out.push(chunk)
  }

  let index = maxNonTextBlockIndex(out) + 1
  for (const call of calls) {
    out.push({ type: 'block-start', index, blockType: 'tool-call' })
    out.push({ type: 'tool-call-delta', index, id: call.id, name: call.name, argumentsDelta: call.arguments })
    out.push({ type: 'block-end', index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments } })
    index += 1
  }
  out.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return out
}

export function apply(ctx) {
  ctx.on('llm/stream', async function* (options, next) {
    const source = next()
    const chunks = []
    for await (const chunk of source) chunks.push(chunk)
    for (const chunk of transform(chunks, options)) yield chunk
  }, { global: true, prepend: true })
}

export const _test = {
  parseToolCallOnlyText,
  transform,
}
