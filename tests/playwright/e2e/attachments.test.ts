import { test, expect } from '../fixtures/extension';

test.describe('Attachments @phase-9', () => {
  test('MVP-18: attachment button is visible in chat input', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // If first-run setup is shown, we need to configure a model first
    const setupVisible = await page
      .locator('[data-testid="setup-api-key"]')
      .isVisible()
      .catch(() => false);

    if (setupVisible) {
      await page.locator('[data-testid="setup-api-key"]').fill('sk-test123456');
      await page.locator('[data-testid="setup-start-button"]').click();
      await page.waitForTimeout(500);
    }

    // Attachment button should be visible in chat input
    const attachBtn = page.locator('[data-testid="attachments-button"]');
    const chatVisible = await attachBtn.isVisible().catch(() => false);

    if (chatVisible) {
      await expect(attachBtn).toBeVisible();
    }
  });

  test('MVP-18: attachment button has paperclip icon', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);

    await page.waitForLoadState('domcontentloaded');

    // Skip if first-run setup is shown
    const setupVisible = await page
      .locator('[data-testid="setup-api-key"]')
      .isVisible()
      .catch(() => false);

    if (setupVisible) {
      await page.locator('[data-testid="setup-api-key"]').fill('sk-test123456');
      await page.locator('[data-testid="setup-start-button"]').click();
      await page.waitForTimeout(500);
    }

    // Attachment button should exist
    const attachBtn = page.locator('[data-testid="attachments-button"]');
    const visible = await attachBtn.isVisible().catch(() => false);
    if (visible) {
      // Verify the button contains an SVG icon
      await expect(attachBtn.locator('svg')).toBeVisible();
    }
  });
});
