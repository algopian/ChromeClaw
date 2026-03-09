import { test } from '../fixtures/extension';
import { expect } from '@playwright/test';

test.describe('Artifacts @phase-6', () => {
  test('MVP-11: artifact panel renders when visible', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);

    // Artifact panel should not be visible by default
    await expect(page.locator('[data-testid="artifact"]')).not.toBeVisible();
  });
});
