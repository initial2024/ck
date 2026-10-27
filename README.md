# dsh-web-relay-toolcall-compat

DSH compatibility bundle for DeepSeek web-relay outputs that express tool calls as ordinary text instead of native DSH `tool-call` chunks.

## Supported relay formats

### Legacy Chinese line format

```text
助手请求调用工具（name=skill, id=call_pet_retry）：{"name":"dsh-desktop-pet"}
```

Multiple exact lines are converted as parallel calls.

### Tagged JSON format

```text
先确认一下插件当前到底装到哪一步了。

<tool_calls>
[
  {"name":"plugin_manager","arguments":{"action":"list_plugins"}},
  {"name":"cordis_inspect_query","arguments":{"platform":"host","provider":"Config","method":"listConfigs","input":{"name":"dsh-web-relay-toolcall-compat"}}}
]
</tool_calls>
```

The JSON array may be wrapped in a `json` code fence. Calls without an `id` receive a deterministic compatibility id. Text before or after the single `<tool_calls>...</tool_calls>` block is retained as assistant text while the calls become native DSH tool calls.

## Safety / strictness

Conversion only occurs when all calls validate against the current request's visible `options.tools` list. The compatibility layer refuses conversion for malformed JSON, non-object arguments, duplicate ids, hidden/unknown tool names, duplicate tagged blocks, forged textual `工具返回（...）` output, existing native DSH tool calls, or non-`stop` terminal finishes such as truncation/error.

Rejected content passes through unchanged as ordinary model output. This prevents arbitrary text from silently becoming executable tool activity.

The middleware consumes downstream `llm/stream` once and is registered with `{ global: true, prepend: true }`. Existing reasoning/non-text chunks are preserved, converted text/tool blocks are emitted before usage, `usage` remains immediately before the terminal `finish`, and successful conversion changes the terminal reason to `tool-calls`.

## Android-friendly installation

Some Android DSH builds cannot execute `git` and fail GitHub installs with `spawn git EACCES`. Use the prepacked tarball instead:

```text
https://raw.githubusercontent.com/initial2024/ck/main/dist/dsh-web-relay-toolcall-compat-0.2.0.tgz
```

Paste that exact plain-text URL into **Add plugin → package name or address**. Do not append query parameters. If version 0.1.0 is already installed, uninstall it first, install 0.2.0, then enable/restart the Web profile as requested by DSH.

## Important boundary

This bundle intercepts the DSH `llm/stream` seam. If a relay bypasses `llm/stream` and directly injects an `assistant/message` session event, this plugin cannot intercept or convert that message. That integration path needs a separate bridge/session adapter.

## Version

`0.2.0`
