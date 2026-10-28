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

Paste that exact plain-text URL into **Add plugin → package name or address**. Do not append query parameters. If an older version is already installed, uninstall it first, install 0.7.0, then enable/restart the Web profile as requested by DSH.

## Important boundary

This bundle intercepts the DSH `llm/stream` seam. If a relay bypasses `llm/stream` and directly injects an `assistant/message` session event, this plugin cannot intercept or convert that message. That integration path needs a separate bridge/session adapter.

## Version

`0.7.0`


## v0.4 partial-batch policy

A relayed batch is no longer all-or-nothing.

For every proposed call, the compatibility layer checks:

1. the tool is present in the current request or live DSH Tool Registry;
2. arguments are a JSON object;
3. arguments satisfy the tool's real JSON Schema before native execution.

Valid calls are emitted as native DSH tool calls. Invalid/unavailable calls are skipped individually.

When one or more calls are skipped, the bundle adds an internal `web_relay_compat_feedback` call. Its result tells the next model turn exactly which calls were skipped and why (for example `tool_not_available` or `schema_validation_failed`). This prevents one bad call from cancelling other valid calls while still keeping unknown/invalid tools non-executable.

## Recommended three-part installation

- `initial2024/wet` — DSH Web Gateway V2 provider 0.2.1.
- `initial2024/ck` — relay/native tool-call compatibility and partial-batch recovery 0.4.0.
- `initial2024/cs` — independent read-only Gateway V2 QA preset 1.0.0.

The provider is the main route. The compatibility bundle is a defensive fallback for web-relay text tool calls. The QA preset does not modify runtime behavior.


## v0.5 native tool-call admission

The compatibility layer now applies the same per-call validation policy to native DSH tool-call streams, not only text-relay formats.

For a native batch:
- valid calls are preserved unchanged;
- unavailable tools are removed before the Agent executes them;
- calls whose arguments fail the real tool JSON Schema are removed before execution;
- a synthetic `web_relay_compat_feedback` call is appended when anything is skipped;
- the feedback result is returned to the model on the next turn.

This closes the gap where an invalid native tool call could previously be silently dropped downstream or fail the whole turn with `PI_AI_ERROR: model produced an invalid tool call`.


## v0.6 mixed-stream handling

Some Web Gateway responses can contain both native DSH tool calls and a textual `<tool_calls>...</tool_calls>` block in the same LLM stream. Earlier versions prioritized the native branch and leaked the tagged text into the conversation.

v0.6 merges both representations safely:
- accepted native calls remain authoritative;
- textual duplicates of an accepted native call are suppressed with `duplicate_of_native_call`;
- additional valid textual calls are converted to native calls;
- unavailable or schema-invalid textual/native calls are skipped;
- all skipped reasons are merged into one `web_relay_compat_feedback` call;
- raw `<tool_calls>` text is removed from the final conversation stream.

Regression coverage now includes text-only, native-only, and mixed native+text batches.


## v0.7 DeepSeek DSML compatibility

DeepSeek V4-family routes may emit DSML tool markup instead of native DSH tool-call chunks. v0.7 adds strict support for:

- canonical full-width DSML: `<｜DSML｜tool_calls>`, `invoke`, and `parameter`;
- degraded ASCII DSML markers such as `<||DSML||tool_calls>`;
- the hybrid Web Gateway form observed in practice: a legacy `<tool_calls>[JSON]` payload followed by residual DSML closing markers;
- malformed protocol envelopes.

Safety policy remains fail-closed:

- every recovered call is still checked against the current request / live DSH Tool Registry;
- argument objects are still validated against the real tool JSON Schema;
- unknown or invalid individual calls are skipped and reported through `web_relay_compat_feedback`;
- a malformed whole envelope is never executed speculatively;
- malformed machine markup is suppressed instead of leaking into assistant prose, and the next model turn receives `malformed_tool_call_envelope` feedback so it can re-issue valid calls.

The native + textual mixed-stream deduplication introduced in v0.6 remains active.
