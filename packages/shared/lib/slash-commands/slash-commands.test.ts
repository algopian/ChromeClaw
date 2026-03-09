import { parseSlashCommand, getSlashCommands, executeSlashCommand } from './index';
import { describe, expect, it, vi } from 'vitest';
import type { SlashCommandContext } from './types';

const mockContext = (): SlashCommandContext => ({
  chatId: 'test-chat',
  messages: [],
  model: { id: 'test', name: 'Test', provider: 'openai', routingMode: 'direct' },
  appendSystemMessage: vi.fn(),
  replaceMessages: vi.fn(),
  clearInput: vi.fn(),
  resetUsage: vi.fn(),
  incrementCompactionCount: vi.fn(),
  setIsCompacting: vi.fn(),
});

describe('parseSlashCommand', () => {
  it('returns null for non-commands', () => {
    expect(parseSlashCommand('hello')).toBeNull();
  });

  it('returns null for invalid slash patterns', () => {
    expect(parseSlashCommand('/ space')).toBeNull();
    expect(parseSlashCommand('//double')).toBeNull();
  });

  it('parses known commands', () => {
    expect(parseSlashCommand('/help')).toEqual({ command: 'help', args: '' });
    expect(parseSlashCommand('/clear')).toEqual({ command: 'clear', args: '' });
    expect(parseSlashCommand('/compact')).toEqual({ command: 'compact', args: '' });
  });

  it('is case-insensitive', () => {
    expect(parseSlashCommand('/HELP')).toEqual({ command: 'help', args: '' });
    expect(parseSlashCommand('/Help')).toEqual({ command: 'help', args: '' });
  });

  it('returns null for unknown commands', () => {
    expect(parseSlashCommand('/unknown')).toBeNull();
    expect(parseSlashCommand('/foo')).toBeNull();
  });

  it('handles leading and trailing whitespace', () => {
    expect(parseSlashCommand('  /help  ')).toEqual({ command: 'help', args: '' });
  });

  it('returns null when command is embedded in text', () => {
    expect(parseSlashCommand('hey /help')).toBeNull();
    expect(parseSlashCommand('run /clear now')).toBeNull();
  });

  it('returns null for multi-line input with command', () => {
    expect(parseSlashCommand('/help\nmore text')).toBeNull();
    expect(parseSlashCommand('/clear\n')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('   ')).toBeNull();
  });

  it('returns null for slash with args', () => {
    expect(parseSlashCommand('/help me')).toBeNull();
  });
});

describe('getSlashCommands', () => {
  it('returns all registered commands', () => {
    const cmds = getSlashCommands();
    const names = cmds.map(c => c.name);
    expect(names).toContain('help');
    expect(names).toContain('clear');
    expect(names).toContain('compact');
    expect(cmds.length).toBe(3);
  });

  it('each command has a name and description', () => {
    for (const cmd of getSlashCommands()) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.description).toBeTruthy();
      expect(typeof cmd.execute).toBe('function');
    }
  });
});

describe('executeSlashCommand', () => {
  it('executes help command and appends system message', async () => {
    const ctx = mockContext();
    const result = await executeSlashCommand('help', ctx);
    expect(result).toBe(true);
    expect(ctx.appendSystemMessage).toHaveBeenCalledOnce();
    expect(ctx.clearInput).toHaveBeenCalledOnce();

    const callArgs = (ctx.appendSystemMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toMatch(/^__cmd_response__help_/);
    expect(callArgs[1]).toContain('/help');
    expect(callArgs[1]).toContain('/clear');
    expect(callArgs[1]).toContain('/compact');
  });

  it('returns false for unknown command', async () => {
    const ctx = mockContext();
    const result = await executeSlashCommand('nonexistent', ctx);
    expect(result).toBe(false);
  });
});
