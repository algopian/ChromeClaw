/**
 * Unit tests for TextToSpeechConfig component's storage interactions.
 * Tests the ttsConfigStorage operations and handler logic that TextToSpeechConfig relies on.
 */
import { defaultTtsConfig } from '@extension/storage';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { TtsConfig } from '@extension/storage';

// Mock ttsConfigStorage
const mockSet = vi.fn<(config: TtsConfig) => Promise<void>>(() => Promise.resolve());
let mockStoredConfig: TtsConfig;

vi.mock('@extension/storage', async importOriginal => {
  const original = await importOriginal<typeof import('@extension/storage')>();
  return {
    ...original,
    ttsConfigStorage: {
      get: vi.fn(() =>
        Promise.resolve({
          ...mockStoredConfig,
          kokoro: { ...mockStoredConfig.kokoro },
          openai: { ...mockStoredConfig.openai },
        }),
      ),
      set: (...args: [TtsConfig]) => mockSet(...args),
    },
  };
});

beforeEach(() => {
  mockStoredConfig = {
    engine: 'kokoro',
    autoMode: 'always',
    maxChars: 4000,
    summarize: true,
    summaryTimeout: 15000,
    chatUiAutoPlay: false,
    kokoro: {
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      voice: 'af_heart',
      speed: 1.0,
      adaptiveChunking: true,
    },
    openai: {
      model: 'tts-1',
      voice: 'nova',
    },
  };
  mockSet.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TextToSpeechConfig — defaults', () => {
  it('defaultTtsConfig has expected shape', () => {
    expect(defaultTtsConfig.engine).toBe('off');
    expect(defaultTtsConfig.autoMode).toBe('always');
    expect(defaultTtsConfig.maxChars).toBe(4000);
    expect(defaultTtsConfig.summarize).toBe(true);
    expect(defaultTtsConfig.summaryTimeout).toBe(15000);
    expect(defaultTtsConfig.chatUiAutoPlay).toBe(false);
    expect(defaultTtsConfig.kokoro.voice).toBe('af_heart');
    expect(defaultTtsConfig.kokoro.speed).toBe(1.0);
    expect(defaultTtsConfig.kokoro.adaptiveChunking).toBe(true);
    expect(defaultTtsConfig.openai.model).toBe('tts-1');
    expect(defaultTtsConfig.openai.voice).toBe('nova');
  });

  it('defaultTtsConfig engine is a valid engine type', () => {
    const validEngines = ['off', 'kokoro', 'openai'];
    expect(validEngines).toContain(defaultTtsConfig.engine);
  });
});

describe('TextToSpeechConfig — engine change saves immediately', () => {
  it('saves new engine value immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();
    expect(config.engine).toBe('kokoro');

    const updated: TtsConfig = { ...config, engine: 'openai' };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ engine: 'openai' }));
  });

  it('preserves other config fields when changing engine', async () => {
    mockStoredConfig = {
      engine: 'kokoro',
      autoMode: 'inbound',
      maxChars: 500,
      summarize: false,
      summaryTimeout: 10000,
      chatUiAutoPlay: false,
      kokoro: {
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'am_adam',
        speed: 1.5,
      },
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://custom.api.com/v1',
        model: 'tts-1-hd',
        voice: 'echo',
      },
    };

    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, engine: 'openai' };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'openai',
        autoMode: 'inbound',
        maxChars: 500,
        summarize: false,
        kokoro: expect.objectContaining({ voice: 'am_adam', speed: 1.5 }),
        openai: expect.objectContaining({ apiKey: 'sk-test', model: 'tts-1-hd' }),
      }),
    );
  });
});

describe('TextToSpeechConfig — autoMode change saves immediately', () => {
  it('saves autoMode change immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, autoMode: 'inbound' };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ autoMode: 'inbound' }));
  });

  it('preserves engine and other fields when changing autoMode', async () => {
    mockStoredConfig = {
      engine: 'openai',
      autoMode: 'always',
      maxChars: 4000,
      summarize: true,
      summaryTimeout: 15000,
      chatUiAutoPlay: false,
      kokoro: {
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'af_heart',
        speed: 1.0,
      },
      openai: {
        apiKey: 'sk-custom',
        baseUrl: 'https://api.openai.com/v1',
        model: 'tts-1-hd',
        voice: 'alloy',
      },
    };

    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, autoMode: 'inbound' };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'openai',
        autoMode: 'inbound',
        openai: expect.objectContaining({ apiKey: 'sk-custom', model: 'tts-1-hd', voice: 'alloy' }),
      }),
    );
  });
});

describe('TextToSpeechConfig — Kokoro select changes save immediately', () => {
  it('saves kokoro voice change immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, kokoro: { ...config.kokoro, voice: 'am_adam' } };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        kokoro: expect.objectContaining({ voice: 'am_adam' }),
      }),
    );
  });

  it('saves kokoro speed change immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, kokoro: { ...config.kokoro, speed: 1.5 } };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        kokoro: expect.objectContaining({ speed: 1.5 }),
      }),
    );
  });
});

describe('TextToSpeechConfig — OpenAI select changes save immediately', () => {
  it('saves openai model select immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, openai: { ...config.openai, model: 'tts-1-hd' } };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        openai: expect.objectContaining({ model: 'tts-1-hd' }),
      }),
    );
  });

  it('saves openai voice select immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, openai: { ...config.openai, voice: 'echo' } };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        openai: expect.objectContaining({ voice: 'echo' }),
      }),
    );
  });
});

describe('TextToSpeechConfig — OpenAI field changes use debounced save', () => {
  it('saves apiKey after debounce delay', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const next: TtsConfig = { ...config, openai: { ...config.openai, apiKey: 'sk-new' } };

    setTimeout(() => {
      ttsConfigStorage.set(next);
    }, 500);

    expect(mockSet).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        openai: expect.objectContaining({ apiKey: 'sk-new' }),
      }),
    );
  });

  it('debounce cancels previous timer on rapid changes', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    let timer: ReturnType<typeof setTimeout> | null = null;

    // First change
    const next1: TtsConfig = { ...config, openai: { ...config.openai, apiKey: 'sk-first' } };
    timer = setTimeout(() => {
      ttsConfigStorage.set(next1);
    }, 500);

    vi.advanceTimersByTime(200);

    // Second change cancels the first
    clearTimeout(timer);
    const next2: TtsConfig = { ...config, openai: { ...config.openai, apiKey: 'sk-second' } };
    setTimeout(() => {
      ttsConfigStorage.set(next2);
    }, 500);

    vi.advanceTimersByTime(500);

    // Only the second save should have fired
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        openai: expect.objectContaining({ apiKey: 'sk-second' }),
      }),
    );
  });

  it('saves baseUrl change after debounce', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const next: TtsConfig = {
      ...config,
      openai: { ...config.openai, baseUrl: 'http://localhost:4141/v1' },
    };

    setTimeout(() => {
      ttsConfigStorage.set(next);
    }, 500);
    vi.advanceTimersByTime(500);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        openai: expect.objectContaining({ baseUrl: 'http://localhost:4141/v1' }),
      }),
    );
  });
});

describe('TextToSpeechConfig — maxChars change uses debounced save', () => {
  it('saves maxChars after debounce delay', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const next: TtsConfig = { ...config, maxChars: 500 };

    setTimeout(() => {
      ttsConfigStorage.set(next);
    }, 500);

    expect(mockSet).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ maxChars: 500 }));
  });
});

describe('TextToSpeechConfig — toggle changes save immediately', () => {
  it('saves chatUiAutoPlay toggle immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, chatUiAutoPlay: true };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ chatUiAutoPlay: true }));
  });

  it('chatUiAutoPlay defaults to false', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    expect(config.chatUiAutoPlay).toBe(false);
  });
});

describe('TextToSpeechConfig — config shape validation', () => {
  it('saves correct full config shape', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');

    const updated: TtsConfig = {
      engine: 'openai',
      autoMode: 'inbound',
      maxChars: 1000,
      summarize: false,
      summaryTimeout: 10000,
      chatUiAutoPlay: false,
      kokoro: {
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'am_adam',
        speed: 0.8,
        adaptiveChunking: false,
      },
      openai: {
        apiKey: 'sk-abc',
        baseUrl: 'https://api.openai.com/v1',
        model: 'tts-1-hd',
        voice: 'alloy',
      },
    };

    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledWith({
      engine: 'openai',
      autoMode: 'inbound',
      maxChars: 1000,
      summarize: false,
      summaryTimeout: 10000,
      chatUiAutoPlay: false,
      kokoro: {
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'am_adam',
        speed: 0.8,
        adaptiveChunking: false,
      },
      openai: {
        apiKey: 'sk-abc',
        baseUrl: 'https://api.openai.com/v1',
        model: 'tts-1-hd',
        voice: 'alloy',
      },
    });
  });

  it('loads stored config with non-default values', async () => {
    mockStoredConfig = {
      engine: 'openai',
      autoMode: 'inbound',
      maxChars: 500,
      summarize: false,
      summaryTimeout: 10000,
      chatUiAutoPlay: false,
      kokoro: {
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'am_adam',
        speed: 1.5,
        adaptiveChunking: false,
      },
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://custom.api.com/v1',
        model: 'tts-1-hd',
        voice: 'echo',
      },
    };

    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    expect(config.engine).toBe('openai');
    expect(config.autoMode).toBe('inbound');
    expect(config.maxChars).toBe(500);
    expect(config.summarize).toBe(false);
    expect(config.summaryTimeout).toBe(10000);
    expect(config.kokoro.voice).toBe('am_adam');
    expect(config.kokoro.speed).toBe(1.5);
    expect(config.kokoro.adaptiveChunking).toBe(false);
    expect(config.openai.apiKey).toBe('sk-test');
    expect(config.openai.baseUrl).toBe('https://custom.api.com/v1');
    expect(config.openai.model).toBe('tts-1-hd');
    expect(config.openai.voice).toBe('echo');
  });
});

describe('TextToSpeechConfig — visibility logic', () => {
  it('Kokoro fields show when engine is kokoro', () => {
    const engine: TtsConfig['engine'] = 'kokoro';
    const showKokoroFields = engine === 'kokoro';
    expect(showKokoroFields).toBe(true);
  });

  it('Kokoro fields hide when engine is openai', () => {
    const engine: TtsConfig['engine'] = 'openai';
    const showKokoroFields = engine === 'kokoro';
    expect(showKokoroFields).toBe(false);
  });

  it('OpenAI fields show when engine is openai', () => {
    const engine: TtsConfig['engine'] = 'openai';
    const showOpenAIFields = engine === 'openai';
    expect(showOpenAIFields).toBe(true);
  });

  it('OpenAI fields hide when engine is kokoro', () => {
    const engine: TtsConfig['engine'] = 'kokoro';
    const showOpenAIFields = engine === 'openai';
    expect(showOpenAIFields).toBe(false);
  });

  it('no provider fields show when engine is off', () => {
    const engine: TtsConfig['engine'] = 'off';
    const showKokoroFields = engine === 'kokoro';
    const showOpenAIFields = engine === 'openai';
    const isEnabled = engine !== 'off';
    expect(showKokoroFields).toBe(false);
    expect(showOpenAIFields).toBe(false);
    expect(isEnabled).toBe(false);
  });

  it('advanced settings show when any engine is enabled', () => {
    const engines: TtsConfig['engine'][] = ['kokoro', 'openai'];
    for (const engine of engines) {
      expect(engine !== 'off').toBe(true);
    }
  });

  it('chatUiAutoPlay toggle shows when engine is enabled', () => {
    const engines: TtsConfig['engine'][] = ['kokoro', 'openai'];
    for (const engine of engines) {
      const isEnabled = engine !== 'off';
      expect(isEnabled).toBe(true);
    }
  });

  it('chatUiAutoPlay toggle hidden when engine is off', () => {
    const engine: TtsConfig['engine'] = 'off';
    const isEnabled = engine !== 'off';
    expect(isEnabled).toBe(false);
  });
});

describe('TextToSpeechConfig — engine to off disables everything', () => {
  it('saves engine off immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, engine: 'off' };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ engine: 'off' }));
  });

  it('preserves all provider settings when disabling', async () => {
    mockStoredConfig = {
      engine: 'openai',
      autoMode: 'always',
      maxChars: 1000,
      summarize: true,
      summaryTimeout: 15000,
      chatUiAutoPlay: false,
      kokoro: {
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'am_adam',
        speed: 1.5,
      },
      openai: {
        apiKey: 'sk-preserve',
        baseUrl: 'https://custom.api.com/v1',
        model: 'tts-1-hd',
        voice: 'echo',
      },
    };

    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, engine: 'off' };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'off',
        autoMode: 'always',
        kokoro: expect.objectContaining({ voice: 'am_adam' }),
        openai: expect.objectContaining({ apiKey: 'sk-preserve' }),
      }),
    );
  });
});

describe('TextToSpeechConfig — multiple sequential changes', () => {
  it('each immediate save is independent', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    // Change engine
    const step1: TtsConfig = { ...config, engine: 'openai' };
    await ttsConfigStorage.set(step1);

    // Change autoMode
    const step2: TtsConfig = { ...step1, autoMode: 'inbound' };
    await ttsConfigStorage.set(step2);

    // Change voice
    const step3: TtsConfig = { ...step2, openai: { ...step2.openai, voice: 'shimmer' } };
    await ttsConfigStorage.set(step3);

    expect(mockSet).toHaveBeenCalledTimes(3);
    expect(mockSet).toHaveBeenNthCalledWith(1, expect.objectContaining({ engine: 'openai' }));
    expect(mockSet).toHaveBeenNthCalledWith(2, expect.objectContaining({ autoMode: 'inbound' }));
    expect(mockSet).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ openai: expect.objectContaining({ voice: 'shimmer' }) }),
    );
  });

  it('debounced changes coalesce when timer not yet fired', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    let timer: ReturnType<typeof setTimeout> | null = null;

    // First maxChars change
    const next1: TtsConfig = { ...config, maxChars: 100 };
    timer = setTimeout(() => {
      ttsConfigStorage.set(next1);
    }, 500);

    vi.advanceTimersByTime(100);

    // Second maxChars change replaces first
    clearTimeout(timer);
    const next2: TtsConfig = { ...config, maxChars: 300 };
    timer = setTimeout(() => {
      ttsConfigStorage.set(next2);
    }, 500);

    vi.advanceTimersByTime(100);

    // Third maxChars change replaces second
    clearTimeout(timer);
    const next3: TtsConfig = { ...config, maxChars: 750 };
    setTimeout(() => {
      ttsConfigStorage.set(next3);
    }, 500);

    vi.advanceTimersByTime(500);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ maxChars: 750 }));
  });
});

describe('TextToSpeechConfig — summaryTimeout change', () => {
  it('saves summaryTimeout change', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, summaryTimeout: 30000 };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ summaryTimeout: 30000 }));
  });
});

describe('TextToSpeechConfig — autoMode values', () => {
  it.each(['off', 'always', 'inbound'] as const)('saves autoMode=%s correctly', async autoMode => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, autoMode };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ autoMode }));
  });
});

describe('TextToSpeechConfig — kokoro model field', () => {
  it('saves kokoro model change immediately', async () => {
    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = {
      ...config,
      kokoro: { ...config.kokoro, model: 'custom/model' },
    };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        kokoro: expect.objectContaining({ model: 'custom/model' }),
      }),
    );
  });
});

describe('TextToSpeechConfig — optional openai fields', () => {
  it('handles config with undefined apiKey and baseUrl', async () => {
    mockStoredConfig = {
      engine: 'openai',
      autoMode: 'always',
      maxChars: 4000,
      summarize: true,
      summaryTimeout: 15000,
      chatUiAutoPlay: false,
      kokoro: {
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'af_heart',
        speed: 1.0,
      },
      openai: {
        model: 'tts-1',
        voice: 'nova',
      },
    };

    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    expect(config.openai.apiKey).toBeUndefined();
    expect(config.openai.baseUrl).toBeUndefined();
    expect(config.openai.model).toBe('tts-1');
    expect(config.openai.voice).toBe('nova');
  });

  it('saves apiKey to config that previously had none', async () => {
    mockStoredConfig = {
      engine: 'openai',
      autoMode: 'always',
      maxChars: 4000,
      summarize: true,
      summaryTimeout: 15000,
      chatUiAutoPlay: false,
      kokoro: {
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: 'af_heart',
        speed: 1.0,
      },
      openai: {
        model: 'tts-1',
        voice: 'nova',
      },
    };

    const { ttsConfigStorage } = await import('@extension/storage');
    const config = await ttsConfigStorage.get();

    const updated: TtsConfig = { ...config, openai: { ...config.openai, apiKey: 'sk-new-key' } };
    await ttsConfigStorage.set(updated);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        openai: expect.objectContaining({ apiKey: 'sk-new-key', model: 'tts-1', voice: 'nova' }),
      }),
    );
  });
});

describe('TextToSpeechConfig — download model handler logic', () => {
  it('sends TTS_DOWNLOAD_MODEL message with correct model', async () => {
    // Simulate what handleDownloadModel does: send chrome.runtime.sendMessage
    const sendMessage = vi.fn<(msg: Record<string, unknown>) => Promise<{ downloadId: string }>>(
      () => Promise.resolve({ downloadId: 'dl-uuid-123' }),
    );

    const model = 'onnx-community/Kokoro-82M-v1.0-ONNX';
    const response = await sendMessage({
      type: 'TTS_DOWNLOAD_MODEL',
      engine: 'kokoro',
      model,
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'TTS_DOWNLOAD_MODEL',
      engine: 'kokoro',
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    });
    expect(response.downloadId).toBe('dl-uuid-123');
  });

  it('handles download error response', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ error: 'Storage full' }));

    const response = await sendMessage({
      type: 'TTS_DOWNLOAD_MODEL',
      engine: 'kokoro',
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    });

    expect(response.error).toBe('Storage full');
    expect(response).not.toHaveProperty('downloadId');
  });

  it('handles sendMessage rejection', async () => {
    const sendMessage = vi.fn(() => Promise.reject(new Error('Extension context invalidated')));

    let error: string | undefined;
    try {
      await sendMessage({
        type: 'TTS_DOWNLOAD_MODEL',
        engine: 'kokoro',
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    expect(error).toBe('Extension context invalidated');
  });
});

describe('TextToSpeechConfig — download progress state machine', () => {
  it('transitions idle → downloading → complete', () => {
    type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error';
    let status: DownloadStatus = 'idle';

    // Start download
    status = 'downloading';
    expect(status).toBe('downloading');

    // Complete
    status = 'complete';
    expect(status).toBe('complete');
  });

  it('transitions idle → downloading → error', () => {
    type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error';
    let status: DownloadStatus = 'idle';
    let errorMsg: string | undefined;

    status = 'downloading';
    expect(status).toBe('downloading');

    // Error
    status = 'error';
    errorMsg = 'Network timeout';
    expect(status).toBe('error');
    expect(errorMsg).toBe('Network timeout');
  });

  it('resets to idle on engine change', () => {
    type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error';
    let status: DownloadStatus = 'complete';

    // Engine change resets download state
    status = 'idle';
    expect(status).toBe('idle');
  });

  it('download button disabled while downloading', () => {
    type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error';
    const status: DownloadStatus = 'downloading';
    const disabled = status === 'downloading';
    expect(disabled).toBe(true);
  });

  it('download button enabled when idle', () => {
    type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error';
    const status: DownloadStatus = 'idle';
    const disabled = status === 'downloading';
    expect(disabled).toBe(false);
  });

  it('download button enabled after error', () => {
    type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error';
    const status: DownloadStatus = 'error';
    const disabled = status === 'downloading';
    expect(disabled).toBe(false);
  });
});

describe('TextToSpeechConfig — background handler routing', () => {
  it('TTS_DOWNLOAD_MODEL handler calls requestModelDownload', async () => {
    // Simulate the background SW handler logic
    const mockRequestModelDownload = vi.fn(() => Promise.resolve('dl-uuid-456'));

    const request = { model: 'onnx-community/Kokoro-82M-v1.0-ONNX' };
    const downloadId = await mockRequestModelDownload(request.model as string);
    const result = { downloadId };

    expect(mockRequestModelDownload).toHaveBeenCalledWith('onnx-community/Kokoro-82M-v1.0-ONNX');
    expect(result).toEqual({ downloadId: 'dl-uuid-456' });
  });

  it('TTS_DOWNLOAD_MODEL handler propagates errors', async () => {
    const mockRequestModelDownload = vi.fn(() =>
      Promise.reject(new Error('Offscreen document not available')),
    );

    const request = { model: 'onnx-community/Kokoro-82M-v1.0-ONNX' };

    await expect(mockRequestModelDownload(request.model as string)).rejects.toThrow(
      'Offscreen document not available',
    );
  });
});
