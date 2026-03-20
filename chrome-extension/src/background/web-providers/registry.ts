/**
 * Web provider registry — definitions for all supported web LLM providers.
 * Each provider specifies auth, request building, and SSE parsing.
 */

import type { WebProviderDefinition, WebProviderId } from './types';

// ── GLM Signing ─────────────────────────────────
// chat.z.ai and chatglm.cn require X-Sign, X-Nonce, X-Timestamp headers.
// Signature = MD5(timestamp-nonce-secret) where timestamp has a checksum digit.

// Public client-side signing constant — extracted from GLM's web frontend JS bundle.
// Not a private server secret; all GLM web clients embed the same value.
const GLM_SIGN_SECRET = '8a1317a7468aa3ad86e997d08f3f31cb';

// Stable device ID persisted across requests to avoid triggering rate limits.
const GLM_DEVICE_ID = crypto.randomUUID();

const generateGlmSign = (): { timestamp: string; nonce: string; sign: string } => {
  const now = Date.now();
  const digits = now.toString();
  const len = digits.length;
  const digitArr = digits.split('').map(Number);
  const sum = digitArr.reduce((acc, v) => acc + v, 0) - digitArr[len - 2];
  const checkDigit = sum % 10;
  const timestamp = digits.substring(0, len - 2) + checkDigit + digits.substring(len - 1);
  const nonce = crypto.randomUUID().replace(/-/g, '');

  // MD5 via SubtleCrypto is async — use a simple sync approach instead.
  // The sign is computed synchronously in the browser extension context.
  // We pre-compute the MD5 using a minimal inline implementation.
  const sign = md5(`${timestamp}-${nonce}-${GLM_SIGN_SECRET}`);
  return { timestamp, nonce, sign };
};

/**
 * Minimal MD5 implementation for GLM request signing.
 * Uses pre-computed K constants to avoid floating-point precision issues.
 */
const md5 = (input: string): string => {
  // Pre-computed K[i] = floor(2^32 * abs(sin(i+1))) — avoids Math.sin precision issues
  /* eslint-disable @typescript-eslint/no-loss-of-precision */
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  /* eslint-enable @typescript-eslint/no-loss-of-precision */
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  // Encode string to UTF-8 bytes
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }

  // MD5 padding
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // Append 64-bit length in little-endian
  for (let i = 0; i < 4; i++) bytes.push((bitLen >>> (i * 8)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push(0); // upper 32 bits (always 0 for short inputs)

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Int32Array(16);
    for (let j = 0; j < 16; j++) {
      w[j] =
        bytes[offset + j * 4] |
        (bytes[offset + j * 4 + 1] << 8) |
        (bytes[offset + j * 4 + 2] << 16) |
        (bytes[offset + j * 4 + 3] << 24);
    }

    let a = a0, b = b0, c = c0, d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16)      { f = (b & c) | (~b & d);     g = i; }
      else if (i < 32) { f = (d & b) | (~d & c);     g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d;               g = (3 * i + 5) % 16; }
      else              { f = c ^ (b | ~d);            g = (7 * i) % 16; }

      const temp = d;
      d = c;
      c = b;
      const sum = ((a + f) | 0) + ((K[i] + w[g]) | 0);
      const rot = S[i];
      b = (b + ((sum << rot) | (sum >>> (32 - rot)))) | 0;
      a = temp;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const hex = (n: number) => {
    const u = n >>> 0;
    return (
      ((u & 0xff).toString(16).padStart(2, '0')) +
      (((u >>> 8) & 0xff).toString(16).padStart(2, '0')) +
      (((u >>> 16) & 0xff).toString(16).padStart(2, '0')) +
      (((u >>> 24) & 0xff).toString(16).padStart(2, '0'))
    );
  };
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
};

// ── Claude Web ──────────────────────────────────

const claudeWeb: WebProviderDefinition = {
  id: 'claude-web',
  name: 'Claude (Web)',
  loginUrl: 'https://claude.ai',
  cookieDomain: '.claude.ai',
  sessionIndicators: ['sessionKey'],
  defaultModelId: 'claude-sonnet-4-5-20250929',
  defaultModelName: 'Claude Sonnet 4.5',
  supportsTools: true,
  supportsReasoning: true,
  contextWindow: 200_000,
  buildRequest: opts => {
    const orgId = opts.credential.cookies['lastActiveOrg'] ?? '';
    const url = `https://api.claude.ai/api/organizations/${orgId}/chat_conversations`;
    return {
      url,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: opts.messages.at(-1)?.content ?? '',
          model: 'claude-sonnet-4-5-20250929',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        credentials: 'include' as RequestCredentials,
      },
    };
  },
  parseSseDelta: data => {
    const obj = data as Record<string, unknown>;
    if (obj.type === 'content_block_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return delta.text;
      }
    }
    return null;
  },
};

// ── Qwen Web ────────────────────────────────────

const qwenWeb: WebProviderDefinition = {
  id: 'qwen-web',
  name: 'Qwen (Web)',
  loginUrl: 'https://chat.qwen.ai',
  cookieDomain: '.qwen.ai',
  sessionIndicators: ['token', 'ctoken', 'login_aliyunid_ticket'],
  defaultModelId: 'qwen3.5-plus',
  defaultModelName: 'Qwen 3.5 Plus',
  supportsTools: true,
  supportsReasoning: true,
  contextWindow: 32_000,
  buildRequest: opts => {
    const fid = crypto.randomUUID();
    const model = 'qwen3.5-plus';

    // Strategy has already built the full prompt in opts.messages[0].content
    const prompt = opts.messages[0]?.content ?? '';
    const chatId = opts.conversationId;

    return {
      // When reusing a conversation, use the chat ID directly; otherwise use template
      url: chatId
        ? `https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`
        : 'https://chat.qwen.ai/api/v2/chat/completions?chat_id={id}',
      urlTemplate: !chatId,
      // Only create a new chat session on first turn (no existing conversation)
      setupRequest: chatId
        ? undefined
        : {
            url: 'https://chat.qwen.ai/api/v2/chats/new',
            init: {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
              credentials: 'include' as RequestCredentials,
            },
          },
      // Stream completions
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          stream: true,
          version: '2.1',
          incremental_output: true,
          chat_id: chatId ?? '{id}',
          chat_mode: 'normal',
          model,
          parent_id: null,
          messages: [
            {
              fid,
              parentId: null,
              childrenIds: [],
              role: 'user',
              content: prompt,
              user_action: 'chat',
              files: [],
              timestamp: Math.floor(Date.now() / 1000),
              models: [model],
              chat_type: 't2t',
              feature_config: {
                thinking_enabled: true,
                output_schema: 'phase',
              },
            },
          ],
        }),
        credentials: 'include' as RequestCredentials,
      },
    };
  },
  parseSseDelta: data => {
    const obj = data as Record<string, unknown>;
    const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined;
    return (
      choices?.[0]?.delta?.content ??
      (obj.text as string | undefined) ??
      (obj.content as string | undefined) ??
      (obj.delta as string | undefined) ??
      null
    );
  },
};

// ── GLM Web (ChatGLM) ──────────────────────────

const glmWeb: WebProviderDefinition = {
  id: 'glm-web',
  name: 'GLM (Web)',
  loginUrl: 'https://chatglm.cn',
  cookieDomain: '.chatglm.cn',
  sessionIndicators: ['chatglm_refresh_token', 'chatglm_token'],
  defaultModelId: 'glm-4',
  defaultModelName: 'GLM-4',
  supportsTools: true,
  supportsReasoning: false,
  contextWindow: 128_000,
  buildRequest: opts => {
    // glmToolStrategy.buildPrompt aggregates all history into a single user message
    const prompt = opts.messages[0]?.content ?? '';

    // Find auth token from stored cookies
    const authToken =
      opts.credential.cookies['chatglm_token'] ?? opts.credential.cookies['access_token'] ?? '';

    // Find refresh token for setupRequest token refresh
    const refreshToken = opts.credential.cookies['chatglm_refresh_token'] ?? '';
    const needsRefresh = !authToken && !!refreshToken;

    // Generate signing headers
    const { timestamp, nonce, sign } = generateGlmSign();
    const setupSign = needsRefresh ? generateGlmSign() : undefined;

    return {
      url: 'https://chatglm.cn/chatglm/backend-api/assistant/stream',
      // Enable template substitution when refreshing token (for {access_token} in Auth header)
      urlTemplate: needsRefresh,
      setupRequest: needsRefresh
        ? {
            url: 'https://chatglm.cn/chatglm/user-api/user/refresh',
            init: {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${refreshToken}`,
                'App-Name': 'chatglm',
                'X-App-Platform': 'pc',
                'X-App-Version': '0.0.1',
                'X-Device-Id': GLM_DEVICE_ID,
                'X-Request-Id': crypto.randomUUID(),
                'X-Sign': setupSign!.sign,
                'X-Nonce': setupSign!.nonce,
                'X-Timestamp': setupSign!.timestamp,
              },
              body: JSON.stringify({}),
              credentials: 'include' as RequestCredentials,
            },
          }
        : undefined,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: authToken
            ? `Bearer ${authToken}`
            : needsRefresh
              ? 'Bearer {access_token}'
              : '',
          'App-Name': 'chatglm',
          'X-App-Platform': 'pc',
          'X-App-Version': '0.0.1',
          'X-App-fr': 'default',
          'X-Device-Brand': '',
          'X-Device-Id': GLM_DEVICE_ID,
          'X-Device-Model': '',
          'X-Lang': 'zh',
          'X-Request-Id': crypto.randomUUID(),
          'X-Sign': sign,
          'X-Nonce': nonce,
          'X-Timestamp': timestamp,
        },
        body: JSON.stringify({
          assistant_id: '65940acff94777010aa6b796',
          conversation_id: opts.conversationId ?? '',
          project_id: '',
          chat_type: 'user_chat',
          meta_data: {
            cogview: { rm_label_watermark: false },
            is_test: false,
            input_question_type: 'xxxx',
            channel: '',
            draft_id: '',
            chat_mode: 'zero',
            is_networking: false,
            quote_log_id: '',
            platform: 'pc',
          },
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: prompt }],
            },
          ],
        }),
        credentials: 'include' as RequestCredentials,
      },
    };
  },
  parseSseDelta: data => {
    const obj = data as Record<string, unknown>;
    const parts = obj.parts as Array<{ content?: Array<{ text?: string }> }> | undefined;
    return parts?.[0]?.content?.[0]?.text ?? null;
  },
};

// ── GLM International ───────────────────────────

const glmIntlWeb: WebProviderDefinition = {
  id: 'glm-intl-web',
  name: 'GLM Intl (Web)',
  loginUrl: 'https://chat.z.ai',
  cookieDomain: '.z.ai',
  sessionIndicators: ['chatglm_refresh_token', 'chatglm_token', 'refresh_token', 'auth_token', 'access_token', 'token'],
  defaultModelId: 'glm-4',
  defaultModelName: 'GLM-4 International',
  supportsTools: true,
  supportsReasoning: false,
  contextWindow: 128_000,
  buildRequest: opts => {
    // glmToolStrategy.buildPrompt aggregates all history into a single user message
    const prompt = opts.messages[0]?.content ?? '';

    // Find an auth token from stored cookies — try multiple possible names
    const tokenNames = ['chatglm_token', 'access_token', 'auth_token', 'token'];
    let authToken = '';
    for (const name of tokenNames) {
      if (opts.credential.cookies[name]) {
        authToken = opts.credential.cookies[name];
        break;
      }
    }

    // Find refresh token for setupRequest token refresh
    const refreshTokenNames = ['chatglm_refresh_token', 'refresh_token'];
    let refreshToken = '';
    for (const name of refreshTokenNames) {
      if (opts.credential.cookies[name]) {
        refreshToken = opts.credential.cookies[name];
        break;
      }
    }

    // Generate signing headers required by chat.z.ai
    const { timestamp, nonce, sign } = generateGlmSign();
    const deviceId = GLM_DEVICE_ID;

    // If no access token but we have a refresh token, use setupRequest to refresh
    const needsRefresh = !authToken && !!refreshToken;
    const setupSign = needsRefresh ? generateGlmSign() : undefined;

    return {
      // Same backend path as chatglm.cn
      url: 'https://chat.z.ai/chatglm/backend-api/assistant/stream',
      // urlTemplate enables template substitution (URL, body, headers) from setupRequest response.
      // Here it's needed for header substitution: {access_token} in Authorization header.
      urlTemplate: needsRefresh,
      // Token refresh step — gets access_token from refresh endpoint
      setupRequest: needsRefresh
        ? {
            url: 'https://chat.z.ai/chatglm/user-api/user/refresh',
            init: {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${refreshToken}`,
                'App-Name': 'chatglm',
                'X-App-Platform': 'pc',
                'X-App-Version': '0.0.1',
                'X-Device-Id': deviceId,
                'X-Request-Id': crypto.randomUUID(),
                'X-Sign': setupSign!.sign,
                'X-Nonce': setupSign!.nonce,
                'X-Timestamp': setupSign!.timestamp,
              },
              body: JSON.stringify({}),
              credentials: 'include' as RequestCredentials,
            },
          }
        : undefined,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          // When refreshing, {access_token} is substituted from setupRequest response
          Authorization: authToken
            ? `Bearer ${authToken}`
            : needsRefresh
              ? 'Bearer {access_token}'
              : '',
          'App-Name': 'chatglm',
          'X-App-Platform': 'pc',
          'X-App-Version': '0.0.1',
          'X-App-fr': 'default',
          'X-Device-Brand': '',
          'X-Device-Id': deviceId,
          'X-Device-Model': '',
          'X-Lang': 'zh',
          'X-Request-Id': crypto.randomUUID(),
          'X-Sign': sign,
          'X-Nonce': nonce,
          'X-Timestamp': timestamp,
        },
        body: JSON.stringify({
          assistant_id: '65940acff94777010aa6b796',
          conversation_id: opts.conversationId ?? '',
          project_id: '',
          chat_type: 'user_chat',
          meta_data: {
            cogview: { rm_label_watermark: false },
            is_test: false,
            input_question_type: 'xxxx',
            channel: '',
            draft_id: '',
            chat_mode: 'zero',
            is_networking: false,
            quote_log_id: '',
            platform: 'pc',
          },
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: prompt }],
            },
          ],
        }),
        credentials: 'include' as RequestCredentials,
      },
    };
  },
  parseSseDelta: data => {
    const obj = data as Record<string, unknown>;
    // GLM uses parts[].content[].text format (same as domestic)
    const parts = obj.parts as Array<{ content?: Array<{ text?: string }> }> | undefined;
    if (parts?.[0]?.content?.[0]?.text != null) return parts[0].content[0].text;
    // Fallback: try common formats
    return (
      (obj.text as string | undefined) ??
      (obj.content as string | undefined) ??
      (obj.delta as string | undefined) ??
      null
    );
  },
};

// ── Kimi Web ────────────────────────────────────

const kimiWeb: WebProviderDefinition = {
  id: 'kimi-web',
  name: 'Kimi (Web)',
  loginUrl: 'https://www.kimi.com',
  cookieDomain: '.kimi.com',
  sessionIndicators: ['kimi-auth'],
  defaultModelId: 'kimi',
  defaultModelName: 'Kimi',
  supportsTools: true,
  supportsReasoning: false,
  contextWindow: 128_000,
  buildRequest: opts => {
    const token = opts.credential.cookies['kimi-auth'] ?? '';
    // kimiToolStrategy.buildPrompt aggregates all history into a single user message
    const prompt = opts.messages[0]?.content ?? '';
    const scenario = 'SCENARIO_K2';
    return {
      url: 'https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat',
      binaryProtocol: 'connect-json' as const,
      binaryEncodeBody: true,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/connect+json',
          'Connect-Protocol-Version': '1',
          'X-Language': 'zh-CN',
          'X-Msh-Platform': 'web',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          scenario,
          message: {
            role: 'user',
            blocks: [{ message_id: '', text: { content: prompt } }],
            scenario,
          },
          options: { thinking: false },
        }),
        credentials: 'include' as RequestCredentials,
      },
    };
  },
  parseSseDelta: data => {
    const obj = data as Record<string, unknown>;
    if (obj.done === true) return null;
    const op = obj.op as string | undefined;
    if (op === 'set' || op === 'append') {
      const block = obj.block as Record<string, unknown> | undefined;
      const text = block?.text as { content?: string } | undefined;
      return text?.content ?? null;
    }
    return null;
  },
};

// ── Doubao Web ──────────────────────────────────

const doubaoWeb: WebProviderDefinition = {
  id: 'doubao-web',
  name: 'Doubao (Web)',
  loginUrl: 'https://doubao.com',
  cookieDomain: '.doubao.com',
  sessionIndicators: ['sessionid'],
  defaultModelId: 'doubao',
  defaultModelName: 'Doubao',
  supportsTools: true,
  supportsReasoning: false,
  contextWindow: 32_000,
  buildRequest: opts => ({
    url: 'https://doubao.com/api/chat/completions',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: opts.systemPrompt }, ...opts.messages],
        stream: true,
      }),
      credentials: 'include' as RequestCredentials,
    },
  }),
  parseSseDelta: data => {
    const obj = data as Record<string, unknown>;
    const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined;
    return choices?.[0]?.delta?.content ?? null;
  },
};

// ── Qwen CN Web ─────────────────────────────────

const qwenCnWeb: WebProviderDefinition = {
  id: 'qwen-cn-web',
  name: 'Qwen CN (Web)',
  loginUrl: 'https://qianwen.com',
  cookieDomain: '.qianwen.com',
  sessionIndicators: ['tongyi_sso_ticket'],
  defaultModelId: 'qwen-max',
  defaultModelName: 'Qwen Max (CN)',
  supportsTools: true,
  supportsReasoning: true,
  contextWindow: 32_000,
  buildRequest: opts => {
    const xsrfToken = opts.credential.cookies['XSRF-TOKEN'] ?? '';
    return {
      url: 'https://qianwen.com/api/chat/completions',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(xsrfToken ? { 'X-XSRF-TOKEN': xsrfToken } : {}),
        },
        body: JSON.stringify({
          model: 'qwen-max',
          messages: [{ role: 'system', content: opts.systemPrompt }, ...opts.messages],
          stream: true,
        }),
        credentials: 'include' as RequestCredentials,
      },
    };
  },
  parseSseDelta: data => {
    const obj = data as Record<string, unknown>;
    const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined;
    return choices?.[0]?.delta?.content ?? null;
  },
};

// ── ChatGPT Web ─────────────────────────────────

const chatgptWeb: WebProviderDefinition = {
  id: 'chatgpt-web',
  name: 'ChatGPT (Web)',
  loginUrl: 'https://chatgpt.com',
  cookieDomain: '.chatgpt.com',
  sessionIndicators: ['__Secure-next-auth.session-token'],
  defaultModelId: 'gpt-4o',
  defaultModelName: 'GPT-4o',
  supportsTools: true,
  supportsReasoning: true,
  contextWindow: 128_000,
  buildRequest: opts => ({
    url: 'https://chatgpt.com/backend-api/conversation',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'next',
        messages: [
          {
            author: { role: 'system' },
            content: { content_type: 'text', parts: [opts.systemPrompt] },
          },
          ...opts.messages.map(m => ({
            author: { role: m.role },
            content: { content_type: 'text', parts: [m.content] },
          })),
        ],
        model: 'gpt-4o',
        parent_message_id: crypto.randomUUID(),
      }),
      credentials: 'include' as RequestCredentials,
    },
  }),
  parseSseDelta: data => {
    const obj = data as Record<string, unknown>;
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content as { parts?: string[] } | undefined;
    if (content?.parts?.[0]) return content.parts[0];
    return null;
  },
};

// ── Registry ────────────────────────────────────

const providers: WebProviderDefinition[] = [
  claudeWeb,
  chatgptWeb,
  kimiWeb,
  doubaoWeb,
  qwenWeb,
  qwenCnWeb,
  glmWeb,
  glmIntlWeb,
];

const providerMap = new Map<WebProviderId, WebProviderDefinition>(providers.map(p => [p.id, p]));

/**
 * Look up a web provider definition by ID.
 */
const getWebProvider = (id: WebProviderId): WebProviderDefinition | undefined =>
  providerMap.get(id);

/**
 * Get all registered web provider definitions.
 */
const getAllWebProviders = (): WebProviderDefinition[] => providers;

export { getWebProvider, getAllWebProviders };
