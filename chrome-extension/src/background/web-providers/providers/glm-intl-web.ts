import type { WebProviderDefinition } from '../types';
import { generateGlmSign, GLM_DEVICE_ID, refreshGlmAuth } from './glm-signing';

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
  refreshAuth: opts => refreshGlmAuth({ ...opts, baseUrl: 'https://chat.z.ai' }),
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

export { glmIntlWeb };
