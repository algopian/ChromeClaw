import './timer-shim';

// ── Baileys trace forwarder ──
// Baileys library code (compiled .js) uses console.log with prefixed tags.
// These run in the offscreen document context and are invisible from the
// service worker console. Intercept them and forward via chrome.runtime so
// they appear in the unified SW log stream.
const TRACE_PREFIXES = ['[BAILEYS-TRACE]', '[SIGNAL-DEBUG]', '[MSG-SEND-DEBUG]', '[SIGNAL-STORAGE]', '[AUTH-UTILS-DEBUG]'];
const _origConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  _origConsoleLog(...args);
  if (typeof args[0] === 'string') {
    const msg = args[0];
    if (TRACE_PREFIXES.some(p => msg.startsWith(p))) {
      // Fire-and-forget forward to service worker
      try {
        chrome.runtime.sendMessage({
          type: 'WA_DEBUG',
          channelId: 'whatsapp',
          event: 'baileys-trace',
          tag: msg,
          data: args.length > 1 ? args[1] : undefined,
        }).catch(() => {});
      } catch { /* extension context may be invalidated */ }
    }
  }
};

import { storageProxy } from './storage-proxy';
import { startTelegramWorker, stopTelegramWorker, updateTelegramOffset } from './telegram-worker';

// WhatsApp worker loaded lazily to avoid loading Baileys polyfills when only Telegram is used
let waWorkerModule: typeof import('./whatsapp-worker') | null = null;
const getWaWorker = async () => {
  if (!waWorkerModule) {
    waWorkerModule = await import('./whatsapp-worker');
  }
  return waWorkerModule;
};

const STORAGE_KEY = 'channelConfigs';

/** Read credentials from storage instead of receiving via broadcast message */
const getCredentials = async (channelId: string): Promise<Record<string, string> | null> => {
  const data = await storageProxy.get(STORAGE_KEY);
  const configs = (data[STORAGE_KEY] ?? []) as Array<{
    channelId: string;
    credentials: Record<string, string>;
  }>;
  const config = configs.find(c => c.channelId === channelId);
  return config?.credentials ?? null;
};

/** Route messages from the service worker to the appropriate channel worker */
chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender, sendResponse) => {
  const type = message.type;
  // R20: Validate message shape before processing
  if (typeof type !== 'string') return false;

  switch (type) {
    case 'CHANNEL_START_WORKER': {
      const channelId = message.channelId;
      const offset = message.offset as number | undefined;
      console.log('[offscreen] CHANNEL_START_WORKER received', { channelId, offset });
      if (typeof channelId !== 'string') {
        sendResponse({ ok: false, error: 'Missing channelId' });
        return false;
      }

      // R8: Async response — return true to keep message channel open
      (async () => {
        try {
          switch (channelId) {
            case 'telegram': {
              const credentials = await getCredentials(channelId);
              if (!credentials?.botToken) {
                sendResponse({ ok: false, error: `No credentials for ${channelId}` });
                return;
              }
              startTelegramWorker(credentials.botToken, offset);
              sendResponse({ ok: true });
              break;
            }
            case 'whatsapp': {
              // WhatsApp reads its own auth state from chrome.storage.local
              console.log('[offscreen] Starting WhatsApp worker via Baileys');
              const wa = await getWaWorker();
              await wa.startWhatsAppWorker();
              console.log('[offscreen] WhatsApp worker started');
              sendResponse({ ok: true });
              break;
            }
            default:
              sendResponse({ ok: false, error: `Unknown channel: ${channelId}` });
          }
        } catch (err) {
          console.error('[offscreen] Failed to start worker:', err);
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true; // R8: Keep channel open for async sendResponse
    }

    case 'CHANNEL_STOP_WORKER': {
      const channelId = message.channelId;
      if (typeof channelId !== 'string') return false;

      switch (channelId) {
        case 'telegram':
          stopTelegramWorker();
          break;
        case 'whatsapp':
          if (waWorkerModule) {
            waWorkerModule.stopWhatsAppWorker();
          }
          break;
        default:
          console.warn(`[offscreen] Unknown channel to stop: ${channelId}`);
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'CHANNEL_ACK_OFFSET': {
      const channelId = message.channelId;
      const offset = message.offset;
      if (typeof channelId !== 'string' || typeof offset !== 'number') return false;

      switch (channelId) {
        case 'telegram':
          updateTelegramOffset(offset);
          break;
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'TRANSCRIBE_AUDIO': {
      const audioBase64 = message.audioBase64;
      const mimeType = message.mimeType;
      const requestId = message.requestId;
      if (
        typeof audioBase64 !== 'string' ||
        typeof mimeType !== 'string' ||
        typeof requestId !== 'string'
      ) {
        sendResponse({ ok: false, error: 'Invalid transcription request' });
        return false;
      }

      // Decode base64 → ArrayBuffer (ArrayBuffer is not JSON-serializable via sendMessage)
      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const audio = bytes.buffer;

      const sttEngine = 'transformers' as const;
      const model = typeof message.model === 'string' ? message.model : 'tiny';
      const language = typeof message.language === 'string' ? message.language : '';

      console.debug('[offscreen] TRANSCRIBE_AUDIO received', {
        model,
        language,
        languageRaw: message.language,
        languageType: typeof message.language,
        mimeType,
        audioBytes: audio.byteLength,
        engine: message.engine,
      });

      // Lazy import — prevents stt-worker init crash from killing the entire message router
      import('./stt-worker')
        .then(({ handleTranscribeRequest }) =>
          handleTranscribeRequest(audio, mimeType, requestId, sttEngine, model, language),
        )
        .catch(err => {
          console.error('[offscreen] Failed to load stt-worker:', err);
          chrome.runtime
            .sendMessage({ type: 'TRANSCRIBE_ERROR', error: String(err), requestId })
            .catch(() => {});
        });
      sendResponse({ ok: true });
      return false;
    }

    case 'STT_DOWNLOAD_MODEL': {
      const model = message.model;
      const downloadId = message.downloadId;
      // downloadId is only set by the background SW's requestModelDownload().
      // Messages from the Options page (without downloadId) are intended for
      // the background SW's messageHandlers — ignore them here so our
      // synchronous sendResponse doesn't race ahead of the background's async response.
      if (typeof model !== 'string' || typeof downloadId !== 'string') {
        return false;
      }

      const sttEngine = 'transformers' as const;

      // Lazy import — prevents stt-worker init crash from killing the entire message router
      import('./stt-worker')
        .then(({ handleModelDownload }) => handleModelDownload(sttEngine, model, downloadId))
        .catch(err => {
          console.error('[offscreen] Failed to load stt-worker:', err);
          chrome.runtime
            .sendMessage({
              type: 'STT_DOWNLOAD_PROGRESS',
              downloadId,
              status: 'error',
              percent: 0,
              error: String(err),
            })
            .catch(() => {});
        });
      sendResponse({ ok: true });
      return false;
    }

    case 'TTS_SYNTHESIZE': {
      const text = message.text;
      const requestId = message.requestId;
      if (typeof text !== 'string' || typeof requestId !== 'string') {
        sendResponse({ ok: false, error: 'Invalid TTS request: missing text or requestId' });
        return false;
      }

      const model =
        typeof message.model === 'string' ? message.model : 'onnx-community/Kokoro-82M-v1.0-ONNX';
      const voice = typeof message.voice === 'string' ? message.voice : 'af_heart';
      const speed = typeof message.speed === 'number' ? message.speed : 1.0;

      // Lazy import — prevents tts-worker init crash from killing the entire message router
      import('./tts-worker')
        .then(({ handleSynthesisRequest }) =>
          handleSynthesisRequest(text, requestId, model, voice, speed),
        )
        .catch(err => {
          console.error('[offscreen] Failed to load tts-worker:', err);
          chrome.runtime
            .sendMessage({ type: 'TTS_ERROR', error: String(err), requestId })
            .catch(() => {});
        });
      sendResponse({ ok: true });
      return false;
    }

    case 'TTS_SYNTHESIZE_STREAM': {
      const text = message.text;
      const requestId = message.requestId;
      if (typeof text !== 'string' || typeof requestId !== 'string') {
        sendResponse({ ok: false, error: 'Invalid TTS stream request: missing text or requestId' });
        return false;
      }

      const model =
        typeof message.model === 'string' ? message.model : 'onnx-community/Kokoro-82M-v1.0-ONNX';
      const voice = typeof message.voice === 'string' ? message.voice : 'af_heart';
      const speed = typeof message.speed === 'number' ? message.speed : 1.0;

      import('./tts-worker')
        .then(({ handleStreamSynthesisRequest }) =>
          handleStreamSynthesisRequest(text, requestId, model, voice, speed),
        )
        .catch(err => {
          console.error('[offscreen] Failed to load tts-worker for streaming:', err);
          chrome.runtime
            .sendMessage({ type: 'TTS_ERROR', error: String(err), requestId })
            .catch(() => {});
        });
      sendResponse({ ok: true });
      return false;
    }

    case 'TTS_SYNTHESIZE_STREAM_BATCHED': {
      const text = message.text;
      const requestId = message.requestId;
      if (typeof text !== 'string' || typeof requestId !== 'string') {
        sendResponse({
          ok: false,
          error: 'Invalid TTS batched stream request: missing text or requestId',
        });
        return false;
      }

      const model =
        typeof message.model === 'string' ? message.model : 'onnx-community/Kokoro-82M-v1.0-ONNX';
      const voice = typeof message.voice === 'string' ? message.voice : 'af_heart';
      const speed = typeof message.speed === 'number' ? message.speed : 1.0;
      const adaptiveChunking =
        typeof message.adaptiveChunking === 'boolean' ? message.adaptiveChunking : true;

      import('./tts-worker')
        .then(({ handleBatchedStreamSynthesisRequest }) =>
          handleBatchedStreamSynthesisRequest(
            text,
            requestId,
            model,
            voice,
            speed,
            adaptiveChunking,
          ),
        )
        .catch(err => {
          console.error('[offscreen] Failed to load tts-worker for batched streaming:', err);
          chrome.runtime
            .sendMessage({ type: 'TTS_ERROR', error: String(err), requestId })
            .catch(() => {});
        });
      sendResponse({ ok: true });
      return false;
    }

    case 'TTS_DOWNLOAD_MODEL': {
      const model = message.model;
      const downloadId = message.downloadId;
      if (typeof model !== 'string' || typeof downloadId !== 'string') {
        return false;
      }

      import('./tts-worker')
        .then(({ handleModelDownload }) => handleModelDownload(model, downloadId))
        .catch(err => {
          console.error('[offscreen] Failed to load tts-worker:', err);
          chrome.runtime
            .sendMessage({
              type: 'TTS_DOWNLOAD_PROGRESS',
              downloadId,
              status: 'error',
              percent: 0,
              error: String(err),
            })
            .catch(() => {});
        });
      sendResponse({ ok: true });
      return false;
    }

    case 'LOCAL_LLM_GENERATE': {
      const requestId = message.requestId;
      const modelId = message.modelId;
      const messages = message.messages;
      const systemPrompt = message.systemPrompt;
      if (
        typeof requestId !== 'string' ||
        typeof modelId !== 'string' ||
        !Array.isArray(messages) ||
        typeof systemPrompt !== 'string'
      ) {
        sendResponse({ ok: false, error: 'Invalid LOCAL_LLM_GENERATE request' });
        return false;
      }

      const maxTokens = typeof message.maxTokens === 'number' ? message.maxTokens : undefined;
      const temperature = typeof message.temperature === 'number' ? message.temperature : undefined;
      const device = typeof message.device === 'string' ? message.device : undefined;
      const tools = Array.isArray(message.tools) ? message.tools : undefined;
      const supportsReasoning =
        typeof message.supportsReasoning === 'boolean' ? message.supportsReasoning : undefined;

      import('./text-gen-worker')
        .then(({ handleGenerateRequest }) =>
          handleGenerateRequest(
            requestId,
            modelId,
            messages as Array<{ role: string; content: string }>,
            systemPrompt,
            maxTokens,
            temperature,
            device,
            tools,
            supportsReasoning,
          ),
        )
        .catch(err => {
          console.error('[offscreen] Failed to load text-gen-worker:', err);
          chrome.runtime
            .sendMessage({ type: 'LOCAL_LLM_ERROR', requestId, error: String(err) })
            .catch(() => {});
        });
      sendResponse({ ok: true });
      return false;
    }

    case 'LOCAL_LLM_DOWNLOAD_MODEL': {
      const modelId = message.modelId;
      const downloadId = message.downloadId;
      if (typeof modelId !== 'string' || typeof downloadId !== 'string') {
        return false;
      }

      const device = typeof message.device === 'string' ? message.device : undefined;

      import('./text-gen-worker')
        .then(({ handleModelDownload }) => handleModelDownload(modelId, downloadId, device))
        .catch(err => {
          console.error('[offscreen] Failed to load text-gen-worker:', err);
          chrome.runtime
            .sendMessage({
              type: 'LOCAL_LLM_DOWNLOAD_PROGRESS',
              downloadId,
              status: 'error',
              percent: 0,
              error: String(err),
            })
            .catch(() => {});
        });
      sendResponse({ ok: true });
      return false;
    }

    case 'LOCAL_LLM_ABORT': {
      const requestId = message.requestId;
      if (typeof requestId !== 'string') return false;

      import('./text-gen-worker')
        .then(({ handleAbort }) => handleAbort(requestId))
        .catch(err => {
          console.error('[offscreen] Failed to load text-gen-worker for abort:', err);
        });
      sendResponse({ ok: true });
      return false;
    }

    // WhatsApp: send message via Baileys socket
    case 'WA_SEND_MESSAGE': {
      const jid = message.jid;
      const text = message.text;
      if (typeof jid !== 'string' || typeof text !== 'string') {
        console.warn('[offscreen] WA_SEND_MESSAGE invalid params', { jid: typeof jid, text: typeof text });
        sendResponse({ ok: false, error: 'Invalid WA_SEND_MESSAGE' });
        return false;
      }

      console.info('[offscreen] WA_SEND_MESSAGE routing', { jid, textLen: text.length });
      const t0wa = Date.now();

      getWaWorker()
        .then(wa => {
          console.info('[offscreen] WA_SEND_MESSAGE worker loaded, connected:', wa.isWhatsAppConnected());
          return wa.sendWhatsAppMessage(jid, text);
        })
        .then(result => {
          console.info('[offscreen] WA_SEND_MESSAGE result', { jid, ok: result.ok, messageId: result.messageId, error: result.error, elapsedMs: Date.now() - t0wa });
          sendResponse(result);
        })
        .catch(err => {
          console.error('[offscreen] WA_SEND_MESSAGE error', { jid, error: String(err), elapsedMs: Date.now() - t0wa });
          sendResponse({ ok: false, error: String(err) });
        });
      return true; // Async response
    }

    // WhatsApp: send audio via Baileys socket
    case 'WA_SEND_AUDIO': {
      const jid = message.jid;
      const audioBase64 = message.audioBase64;
      const ptt = message.ptt;
      if (typeof jid !== 'string' || typeof audioBase64 !== 'string' || typeof ptt !== 'boolean') {
        console.warn('[offscreen] WA_SEND_AUDIO invalid params', { jid: typeof jid, audioBase64: typeof audioBase64, ptt: typeof ptt });
        sendResponse({ ok: false, error: 'Invalid WA_SEND_AUDIO' });
        return false;
      }

      // Decode base64 → ArrayBuffer
      const binaryAudio = atob(audioBase64);
      const audioBytes = new Uint8Array(binaryAudio.length);
      for (let i = 0; i < binaryAudio.length; i++) {
        audioBytes[i] = binaryAudio.charCodeAt(i);
      }
      const audioBuffer = audioBytes.buffer;

      console.info('[offscreen] WA_SEND_AUDIO routing', { jid, audioBytes: audioBuffer.byteLength, ptt });
      const t0audio = Date.now();

      getWaWorker()
        .then(wa => wa.sendWhatsAppAudio(jid, audioBuffer, ptt))
        .then(result => {
          console.info('[offscreen] WA_SEND_AUDIO result', { jid, ok: result.ok, messageId: result.messageId, error: result.error, elapsedMs: Date.now() - t0audio });
          sendResponse(result);
        })
        .catch(err => {
          console.error('[offscreen] WA_SEND_AUDIO error', { jid, error: String(err), elapsedMs: Date.now() - t0audio });
          sendResponse({ ok: false, error: String(err) });
        });
      return true; // Async response
    }

    // WhatsApp: set typing indicator
    case 'WA_SET_TYPING': {
      const jid = message.jid;
      const isTyping = message.isTyping;
      if (typeof jid !== 'string' || typeof isTyping !== 'boolean') {
        sendResponse({ ok: false });
        return false;
      }

      getWaWorker()
        .then(wa => wa.setWhatsAppTyping(jid, isTyping))
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true; // Async response
    }
  }

  return false;
});

console.log('[offscreen] Channel workers router initialized');
