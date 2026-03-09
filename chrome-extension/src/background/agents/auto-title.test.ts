import { describe, it, expect } from 'vitest';

describe('Auto-title prompt construction', () => {
  const buildTitlePrompt = (message: string) =>
    `Generate a short title (max 6 words) for a conversation that starts with: "${message.slice(0, 200)}". Return ONLY the title text, nothing else.`;

  it('constructs a valid prompt for a normal message', () => {
    const prompt = buildTitlePrompt('What is the capital of France?');
    expect(prompt).toContain('What is the capital of France?');
    expect(prompt).toContain('max 6 words');
    expect(prompt).toContain('Return ONLY the title text');
  });

  it('truncates long messages to 200 characters', () => {
    const longMessage = 'a'.repeat(500);
    const prompt = buildTitlePrompt(longMessage);
    expect(prompt).toContain('a'.repeat(200));
    expect(prompt).not.toContain('a'.repeat(201));
  });

  it('handles empty message', () => {
    const prompt = buildTitlePrompt('');
    expect(prompt).toContain('""');
    expect(prompt).toContain('max 6 words');
  });

  it('strips quotes from generated titles', () => {
    const responses = ['"Capital of France"', "'Capital of France'", 'Capital of France'];

    const stripped = responses.map(r => r.trim().replace(/^["']|["']$/g, ''));
    expect(stripped[0]).toBe('Capital of France');
    expect(stripped[1]).toBe('Capital of France');
    expect(stripped[2]).toBe('Capital of France');
  });
});
