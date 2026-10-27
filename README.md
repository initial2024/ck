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

Conversion validates tool names against the union of the current request's native `options.tools` list and the live DSH Tool Registry view for the current session's Agent (`ctx.tools.schemas(agent)`). This lets text-only/web-relay routes use tools that are genuinely registered in DSH even when the relay did not carry a complete native tool list. The compatibility layer refuses conversion for malformed JSON, non-object arguments, duplicate ids, hidden/unknown tool names, duplicate tagged blocks, forged textual `工具返回（...）` output, existing native DSH tool calls, or non-`stop` terminal finishes such as truncation/error.

Rejected content passes through unchanged as ordinary model output. This prevents arbitrary text from silently becoming executable tool activity.

The middleware consumes downstream `llm/stream` once and is registered with `{ global: true, prepend: true }`. Existing reasoning/non-text chunks are preserved, converted text/tool blocks are emitted before usage, `usage` remains immediately before the terminal `finish`, and successful conversion changes the terminal reason to `tool-calls`.

## Android-friendly installation

Some Android DSH builds cannot execute `git` and fail GitHub installs with `spawn git EACCES`. Use the GitHub source tarball instead:

```text
https://github.com/initial2024/ck/archive/refs/heads/main.tar.gz
```

Paste that exact plain-text URL into **Add plugin → package name or address**. Do not append query parameters. If an older version is already installed, uninstall it first, install 0.3.0, then enable/restart the Web profile as requested by DSH.

## Important boundary

This bundle intercepts the DSH `llm/stream` seam. If a relay bypasses `llm/stream` and directly injects an `assistant/message` session event, this plugin cannot intercept or convert that message. That integration path needs a separate bridge/session adapter.

## Version

`0.3.0`
