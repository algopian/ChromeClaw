import type { WebProviderDefinition } from '../types';
import { generateGlmSign, GLM_DEVICE_ID, refreshGlmAuth } from './glm-signing';

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
  refreshAuth: opts => refreshGlmAuth({ ...opts, baseUrl: 'https://chatglm.cn' }),
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

export { glmWeb };
