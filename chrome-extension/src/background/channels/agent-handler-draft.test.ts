import { describe, expect, it } from 'vitest';

/**
 * Tests for the draftPromise chain pattern used in agent-handler.ts.
 * Validates that flushDraft + onTurnEnd chaining does not deadlock.
 *
 * Regression: commit 62460d5 introduced a circular promise dependency where
 * flushDraft() internally awaited the same draftPromise variable that
 * onTurnEnd had chained flushDraft() onto, creating a cycle that never resolved.
 */
describe('draftPromise chain (agent-handler)', () => {
  it('FIXED pattern: flushDraft without await draftPromise resolves', async () => {
    let draftPromise = Promise.resolve();
    let flushCount = 0;

    // Fixed flushDraft: does NOT await draftPromise (callers ensure chain resolved)
    const flushDraft = async () => {
      flushCount++;
    };

    // Simulate onTurnEnd: chain flush then reset onto draftPromise
    draftPromise = draftPromise.then(() => flushDraft());
    draftPromise = draftPromise.then(() => {
      /* reset state */
    });

    // Simulate line 427: await draftPromise (explicit), then flushDraft
    const result = await Promise.race([
      draftPromise.then(() => flushDraft()).then(() => 'resolved' as const),
      new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 2000)),
    ]);

    expect(result).toBe('resolved');
    expect(flushCount).toBe(2); // once from onTurnEnd, once from line 427
  });

  it('REGRESSION: old pattern with await draftPromise inside flushDraft deadlocks', async () => {
    let draftPromise = Promise.resolve();

    // OLD flushDraft: reads the module-level draftPromise → circular dependency
    const flushDraftOld = async () => {
      await draftPromise;
    };

    // onTurnEnd chains flushDraftOld onto draftPromise, then chains reset
    draftPromise = draftPromise.then(() => flushDraftOld());
    draftPromise = draftPromise.then(() => {});

    const result = await Promise.race([
      draftPromise.then(() => 'resolved' as const),
      new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 500)),
    ]);

    // The old pattern deadlocks — draftPromise never resolves
    expect(result).toBe('timeout');
  });
});
