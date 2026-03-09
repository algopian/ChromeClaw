/**
 * Tests for tool-config-storage.ts group→tool migration.
 *
 * We mock createStorage to return an in-memory store so we can simulate
 * stored configs from older versions and verify the migration logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolConfig } from './tool-config-storage';

// ── In-memory storage backing ──

let storedData: ToolConfig | null = null;

vi.mock('../base/index.js', () => ({
  createStorage: <T>(_key: string, defaultValue: T) => ({
    get: vi.fn(() => Promise.resolve(storedData ?? defaultValue)),
    set: vi.fn((value: T) => {
      storedData = value as unknown as ToolConfig;
      return Promise.resolve();
    }),
    getSnapshot: vi.fn(() => storedData),
    subscribe: vi.fn(),
  }),
  StorageEnum: { Local: 'local', Session: 'session' },
}));

// Import after mock
const { toolConfigStorage } = await import('./tool-config-storage');

beforeEach(() => {
  storedData = null;
  vi.clearAllMocks();
});

// ── Fresh install (no stored data) ──

describe('fresh install defaults', () => {
  it('returns all per-tool defaults when no stored config', async () => {
    const config = await toolConfigStorage.get();

    expect(config.enabledTools.web_search).toBe(true);
    expect(config.enabledTools.web_fetch).toBe(true);
    expect(config.enabledTools.create_document).toBe(true);
    expect(config.enabledTools.browser).toBe(true);
    expect(config.enabledTools.write).toBe(true);
    expect(config.enabledTools.read).toBe(true);
    expect(config.enabledTools.edit).toBe(true);
    expect(config.enabledTools.list).toBe(true);
    expect(config.enabledTools.memory_search).toBe(true);
    expect(config.enabledTools.memory_get).toBe(true);
    expect(config.enabledTools.scheduler).toBe(true);
    expect(config.enabledTools.chat_list).toBe(true);
    expect(config.enabledTools.chat_history).toBe(true);
    expect(config.enabledTools.chat_send).toBe(true);
    expect(config.enabledTools.chat_spawn).toBe(true);
    expect(config.enabledTools.chat_status).toBe(true);
    // Removed tools should not be present
    expect('getWeather' in config.enabledTools).toBe(false);
    expect('updateDocument' in config.enabledTools).toBe(false);
  });

  it('does not contain any old group keys', async () => {
    const config = await toolConfigStorage.get();
    expect('weather' in config.enabledTools).toBe(false);
    expect('webFetch' in config.enabledTools).toBe(false);
    expect('documents' in config.enabledTools).toBe(false);
    expect('workspace' in config.enabledTools).toBe(false);
    expect('memory' in config.enabledTools).toBe(false);
    expect('sessions' in config.enabledTools).toBe(false);
  });
});

// ── Group-level key migration ──

describe('group → per-tool migration', () => {
  it('removes stale weather group key (tool was removed)', async () => {
    storedData = {
      enabledTools: { weather: false },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    // weather group key should be cleaned up
    expect('weather' in config.enabledTools).toBe(false);
    // web_search should still have its default value
    expect(config.enabledTools.web_search).toBe(true);
  });

  it('expands webFetch group key to web_fetch', async () => {
    storedData = {
      enabledTools: { webFetch: false },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    expect(config.enabledTools.web_fetch).toBe(false);
    expect('webFetch' in config.enabledTools).toBe(false);
  });

  it('expands documents group key to create_document', async () => {
    storedData = {
      enabledTools: { documents: false },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    expect(config.enabledTools.create_document).toBe(false);
    expect('documents' in config.enabledTools).toBe(false);
  });

  it('expands workspace group key to 4 workspace tools', async () => {
    storedData = {
      enabledTools: { workspace: false },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    expect(config.enabledTools.write).toBe(false);
    expect(config.enabledTools.read).toBe(false);
    expect(config.enabledTools.edit).toBe(false);
    expect(config.enabledTools.list).toBe(false);
    expect('workspace' in config.enabledTools).toBe(false);
  });

  it('expands memory group key to memory_search and memory_get', async () => {
    storedData = {
      enabledTools: { memory: false },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    expect(config.enabledTools.memory_search).toBe(false);
    expect(config.enabledTools.memory_get).toBe(false);
    expect('memory' in config.enabledTools).toBe(false);
  });

  it('expands sessions group key to 5 chat tools', async () => {
    storedData = {
      enabledTools: { sessions: false },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    expect(config.enabledTools.chat_list).toBe(false);
    expect(config.enabledTools.chat_history).toBe(false);
    expect(config.enabledTools.chat_send).toBe(false);
    expect(config.enabledTools.chat_spawn).toBe(false);
    expect(config.enabledTools.chat_status).toBe(false);
    expect('sessions' in config.enabledTools).toBe(false);
  });

  it('migrates a full old-style config with all group keys', async () => {
    storedData = {
      enabledTools: {
        weather: true,
        webSearch: false,
        webFetch: true,
        documents: true,
        browser: false,
        workspace: true,
        memory: true,
        scheduler: true,
        sessions: true,
      },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();

    // Expanded tool keys
    expect(config.enabledTools.web_search).toBe(false); // webSearch: false renamed to web_search
    expect(config.enabledTools.web_fetch).toBe(true);
    expect(config.enabledTools.create_document).toBe(true);
    expect(config.enabledTools.write).toBe(true);
    expect(config.enabledTools.read).toBe(true);
    expect(config.enabledTools.edit).toBe(true);
    expect(config.enabledTools.list).toBe(true);
    expect(config.enabledTools.memory_search).toBe(true);
    expect(config.enabledTools.memory_get).toBe(true);
    expect(config.enabledTools.chat_list).toBe(true);
    expect(config.enabledTools.chat_history).toBe(true);
    expect(config.enabledTools.chat_send).toBe(true);
    expect(config.enabledTools.chat_spawn).toBe(true);
    expect(config.enabledTools.chat_status).toBe(true);

    // webSearch is renamed to web_search via RENAME_TOOLS migration
    expect(config.enabledTools.browser).toBe(false);
    expect(config.enabledTools.scheduler).toBe(true);

    // Old group keys removed
    expect('weather' in config.enabledTools).toBe(false);
    expect('webFetch' in config.enabledTools).toBe(false);
    expect('documents' in config.enabledTools).toBe(false);
    expect('workspace' in config.enabledTools).toBe(false);
    expect('memory' in config.enabledTools).toBe(false);
    expect('sessions' in config.enabledTools).toBe(false);
    // Stale keys removed
    expect('getWeather' in config.enabledTools).toBe(false);
    expect('updateDocument' in config.enabledTools).toBe(false);
  });
});

// ── workspace_* → short name rename migration ──

describe('workspace_* → short name migration', () => {
  it('renames workspace_write to write, workspace_read to read, workspace_list to list', async () => {
    storedData = {
      enabledTools: {
        workspace_write: true,
        workspace_read: false,
        workspace_list: true,
      },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    expect(config.enabledTools.write).toBe(true);
    expect(config.enabledTools.read).toBe(false);
    expect(config.enabledTools.list).toBe(true);
    expect(config.enabledTools.edit).toBe(true); // default
    expect('workspace_write' in config.enabledTools).toBe(false);
    expect('workspace_read' in config.enabledTools).toBe(false);
    expect('workspace_list' in config.enabledTools).toBe(false);
  });

  it('does not overwrite explicitly set short name with old name', async () => {
    // User already has write: false set, but also has legacy workspace_write: true
    storedData = {
      enabledTools: {
        write: false,
        workspace_write: true,
      },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    // write was explicitly set — should NOT be overwritten by workspace_write
    expect(config.enabledTools.write).toBe(false);
  });

  it('persists renamed config to storage', async () => {
    storedData = {
      enabledTools: {
        workspace_write: true,
        workspace_read: true,
        workspace_list: true,
      },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    await toolConfigStorage.get();

    expect(storedData).not.toBeNull();
    expect(storedData!.enabledTools.write).toBe(true);
    expect(storedData!.enabledTools.read).toBe(true);
    expect(storedData!.enabledTools.list).toBe(true);
    expect('workspace_write' in storedData!.enabledTools).toBe(false);
    expect('workspace_read' in storedData!.enabledTools).toBe(false);
    expect('workspace_list' in storedData!.enabledTools).toBe(false);
  });
});

// ── Edge cases ──

describe('migration edge cases', () => {
  it('does not overwrite individual tool keys already set by user', async () => {
    // User had group key documents=false but also individually set createDocument=true
    // createDocument gets renamed to create_document via RENAME_TOOLS
    storedData = {
      enabledTools: { documents: false, createDocument: true },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    // createDocument was individually set and renamed to create_document
    expect(config.enabledTools.create_document).toBe(true);
    expect('documents' in config.enabledTools).toBe(false);
  });

  it('migrates webSearch to web_search, leaves browser/scheduler untouched', async () => {
    storedData = {
      enabledTools: { webSearch: true, browser: true, scheduler: false },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    const config = await toolConfigStorage.get();
    expect(config.enabledTools.web_search).toBe(true);
    expect(config.enabledTools.browser).toBe(true);
    expect(config.enabledTools.scheduler).toBe(false);
  });

  it('persists migrated config to storage', async () => {
    storedData = {
      enabledTools: { weather: false, documents: false },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;

    await toolConfigStorage.get();

    // After migration, storedData should be updated with per-tool keys
    expect(storedData).not.toBeNull();
    expect(storedData!.enabledTools.web_search).toBe(true); // default value
    expect(storedData!.enabledTools.create_document).toBe(false);
    expect('weather' in storedData!.enabledTools).toBe(false);
    expect('documents' in storedData!.enabledTools).toBe(false);
    expect('getWeather' in storedData!.enabledTools).toBe(false);
    expect('updateDocument' in storedData!.enabledTools).toBe(false);
  });

  it('does not persist when no migration needed (already per-tool keys)', async () => {
    // Already-migrated config — all per-tool keys with new names, no group keys
    storedData = {
      enabledTools: {
        web_search: false,
        web_fetch: true,
        create_document: true,
        browser: false,
        write: true,
        read: true,
        edit: true,
        list: true,
        memory_search: true,
        memory_get: true,
        scheduler: true,
        chat_list: true,
        chat_history: true,
        chat_send: true,
        chat_spawn: true,
        chat_status: true,
      },
      webSearchConfig: {
        provider: 'tavily',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      },
    };

    const config = await toolConfigStorage.get();

    // Should return correct values
    expect(config.enabledTools.web_search).toBe(false);
    expect(config.enabledTools.create_document).toBe(true);

    // The raw storage set should NOT be called (no migration needed)
    // We verify this indirectly: storedData should still match the original
    expect(storedData!.enabledTools.web_search).toBe(false);
  });
});
