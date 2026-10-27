# dsh-web-relay-toolcall-compat

DSH compatibility bundle for non-API DeepSeek web-relay outputs that express tool calls as Chinese text instead of native DSH `tool-call` chunks.

## What it converts

Exact tool-call-only lines such as:

```text
助手请求调用工具（name=skill, id=call_pet_retry）：{"name":"dsh-desktop-pet"}
```

are converted into native DSH stream chunks and terminate the model turn with:

```text
finish.kind = tool-calls
```

Multiple exact tool-call lines in one model response are converted as parallel calls.

## Safety / strictness

The compatibility layer deliberately refuses conversion when any of these are present:

- malformed JSON;
- JSON that is not an object;
- a duplicate call id;
- a tool name that is not present in the current request's visible `options.tools` list;
- any extra prose mixed with the tool-call lines;
- a forged textual `工具返回（...）` line;
- an existing native DSH tool call;
- a non-`stop` terminal finish such as truncation/error.

Rejected content is passed through unchanged as ordinary model output, so malformed text does not become executable tool activity.

The plugin consumes the downstream `llm/stream` exactly once and is registered with `{ global: true, prepend: true }`. Ordinary non-tool output, native tool calls, reasoning chunks, usage chunks, and non-convertible streams are preserved.

## Install from DSH UI

In **Add plugin**, paste either:

```text
https://github.com/initial2024/ck.git
```

or, if the UI expects a pnpm/GitHub package spec:

```text
github:initial2024/ck#main
```

Then press **解析 / Parse** and **安装 / Install**. Bundle installs normally require restarting the DSH Web profile before activation.

CLI equivalent:

```bash
dsh plugin --profile web add "github:initial2024/ck#main"
```

## Relay output contract

For maximum reliability, instruct the DeepSeek web relay to emit tool requests with no surrounding prose, one call per line:

```text
助手请求调用工具（name=<tool-name>, id=<unique-call-id>）：<JSON-object>
```

Do not have the model invent textual tool-result lines. Real tool results must come from DSH.

## Important boundary

This bundle intercepts the DSH `llm/stream` seam. If a relay bypasses `llm/stream` and directly injects an `assistant/message` session event, this plugin cannot intercept or convert that message. That integration path needs a separate bridge/session adapter.

## Version

`0.1.0`
