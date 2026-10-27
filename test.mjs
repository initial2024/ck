import assert from 'node:assert/strict'
import { _test } from './index.js'

const tools = [{ name: 'skill' }, { name: 'bash' }, { name: 'plugin_manager' }, { name: 'cordis_inspect_query' }]
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
  const text = '先确认一下插件当前到底装到哪一步了。\n\n<tool_calls>\n[{"name":"plugin_manager","arguments":{"action":"list_plugins","limit":7,"offset":200}},{"name":"cordis_inspect_query","arguments":{"platform":"host","provider":"Config","method":"listConfigs","input":{"name":"dsh-web-relay-toolcall-compat"}}}]\n</tool_calls>'
  const out = _test.transform(stream(text), options)
  assert.equal(out.at(-1).reason.kind, 'tool-calls')
  const calls = out.filter(x => x.type === 'block-end' && x.block?.type === 'tool-call')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].block.name, 'plugin_manager')
  assert.equal(calls[1].block.name, 'cordis_inspect_query')
  const prose = out.find(x => x.type === 'block-end' && x.block?.type === 'text')
  assert.equal(prose.block.text, '先确认一下插件当前到底装到哪一步了。')
  assert.equal(out.at(-2).type, 'usage')
}
{
  const text = '<tool_calls>\n```json\n[{"name":"bash","arguments":{"cmd":"echo ok"}}]\n```\n</tool_calls>'
  const out = _test.transform(stream(text), options)
  assert.equal(out.at(-1).reason.kind, 'tool-calls')
  assert.equal(out.find(x => x.type === 'block-end').block.name, 'bash')
}
{
  const text = '<tool_calls>[{"name":"bash","arguments":"{\\"cmd\\":\\"echo ok\\"}"}]</tool_calls>'
  const out = _test.transform(stream(text), options)
  assert.equal(out.at(-1).reason.kind, 'tool-calls')
}
for (const text of [
  '助手请求调用工具（name=skill, id=a）：not-json',
  '助手请求调用工具（name=skill, id=a）：[]',
  '助手请求调用工具（name=skill, id=a）：{"x":1}\n助手请求调用工具（name=skill, id=a）：{"x":2}',
  '助手请求调用工具（name=hidden, id=a）：{"x":1}',
  '先执行这个\n助手请求调用工具（name=skill, id=a）：{"x":1}',
  '工具返回（name=skill, id=a）：ok',
  '<tool_calls>not-json</tool_calls>',
  '<tool_calls>[{"name":"hidden","arguments":{}}]</tool_calls>',
  '<tool_calls>[{"name":"bash","arguments":[]}]</tool_calls>',
  '<tool_calls>[{"name":"bash","arguments":{}}]</tool_calls><tool_calls>[{"name":"bash","arguments":{}}]</tool_calls>',
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
