import assert from 'node:assert/strict'
import { _test } from './index.js'

const tools = [{ name: 'skill' }, { name: 'bash' }]
const options = { tools }
const stream = text => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
  { type: 'finish', reason: { kind: 'stop' } },
]

{
  const text = '助手请求调用工具（name=skill, id=call_pet_retry）：{"name":"dsh-desktop-pet"}'
  const out = _test.transform(stream(text), options)
  assert.equal(out.at(-1).reason.kind, 'tool-calls')
  assert.equal(out.find(x => x.type === 'block-end').block.name, 'skill')
  assert.equal(out.find(x => x.type === 'block-end').block.arguments, '{"name":"dsh-desktop-pet"}')
}
{
  const text = '助手请求调用工具（name=bash, id=a）：{"cmd":"one"}\n助手请求调用工具（name=bash, id=b）：{"cmd":"two"}'
  const out = _test.transform(stream(text), options)
  assert.equal(out.filter(x => x.type === 'block-end').length, 2)
}
for (const text of [
  '助手请求调用工具（name=skill, id=a）：not-json',
  '助手请求调用工具（name=skill, id=a）：[]',
  '助手请求调用工具（name=skill, id=a）：{"x":1}\n助手请求调用工具（name=skill, id=a）：{"x":2}',
  '助手请求调用工具（name=hidden, id=a）：{"x":1}',
  '先执行这个\n助手请求调用工具（name=skill, id=a）：{"x":1}',
  '工具返回（name=skill, id=a）：ok',
]) {
  const original = stream(text)
  const out = _test.transform(original, options)
  assert.deepEqual(out, original)
}
{
  const native = [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'x', name: 'skill', arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
  assert.deepEqual(_test.transform(native, options), native)
}
console.log('PASS')
