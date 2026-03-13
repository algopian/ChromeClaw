# Fix: GLM-4.7 "developer" role rejection

## Context

GLM-4.7 returns `400 角色信息不正确` ("Incorrect role information") because pi-ai sends the `"developer"` role for the system prompt when `model.reasoning` is true. The official [Z.AI Chat Completion API docs](https://docs.z.ai/api-reference/llm/chat-completion) confirm only `system`, `user`, `assistant`, and `tool` roles are supported — **not** `developer`.

This is a known issue: [pi-mono#547](https://github.com/badlogic/pi-mono/issues/547) filed the same bug, and PR #548 added a `supportsSystemRole` compat flag. However, our pinned pi-ai version doesn't include that fix yet.

The root cause in pi-ai (`openai-completions.js:425-426`):
```js
const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
const role = useDeveloperRole ? "developer" : "system";
```

pi-ai's `detectCompat()` only marks specific known providers (cerebras, xai, mistral, deepseek, z.ai, opencode) as `isNonStandard`. A user-configured GLM-4.7 via `custom` provider with a non-z.ai baseUrl isn't detected, so `supportsDeveloperRole` defaults to `true`.

## Fix (already applied)

**File:** `chrome-extension/src/background/agents/model-adapter.ts`

Set `compat: { supportsDeveloperRole: false }` for all non-first-party OpenAI providers. This forces pi-ai to always use `"system"` role instead of `"developer"`:

```ts
const compat =
  api === 'openai-completions' && config.provider !== 'openai'
    ? { supportsDeveloperRole: false }
    : undefined;
```

This is safe because:
- Only actual OpenAI endpoints support `"developer"` role
- OpenRouter proxies to various providers that may not support it
- Custom/compatible providers (GLM, vLLM, LMStudio, etc.) use standard roles
- The `tool` role is fine — Z.AI docs confirm it's supported

## Verification

1. `pnpm build` passes (16/16)
2. Load extension, configure GLM-4.7 as custom provider with reasoning enabled
3. Send a message — should use `"system"` role and succeed
