import { test, expect } from '../fixtures/extension';

/**
 * Integration test for copilot-api proxy.
 *
 * Prerequisites:
 *   - copilot-api running at http://localhost:4141/v1
 *   - Extension built: cd extension && pnpm build
 *
 * Run:
 *   cd extension && pnpm test:e2e -- --grep @copilot-api
 */
test.describe('@copilot-api Integration: copilot-api proxy', () => {
  test('configure custom model with copilot-api and get a response', async ({
    extensionId,
    context,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
    await page.waitForLoadState('domcontentloaded');

    // Step 1: Wait for the first-run setup to appear
    const setupApiKey = page.locator('[data-testid="setup-api-key"]');
    await expect(setupApiKey).toBeVisible({ timeout: 10000 });

    // Step 2: Configure copilot-api proxy
    // Select "Custom" provider
    const providerSelect = page.locator('#setup-provider');
    await providerSelect.click();
    await page.locator('[role="option"]').filter({ hasText: 'Custom' }).click();

    // Set Model ID to gpt-5.1
    const modelIdInput = page.locator('[data-testid="setup-model-id"]');
    await modelIdInput.clear();
    await modelIdInput.fill('gpt-5.1');

    // Set Base URL to copilot-api proxy
    const baseUrlInput = page.locator('[data-testid="setup-base-url"]');
    await baseUrlInput.fill('http://localhost:4141/v1');

    // API key is optional for proxies — leave empty

    // Step 3: Click "Start Chatting"
    const startButton = page.locator('[data-testid="setup-start-button"]');
    await startButton.click();

    // Wait for chat UI to load
    await page.waitForTimeout(1000);

    // Verify chat input is visible (setup completed successfully)
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Step 4: Send a message
    await textarea.fill('Say "hello world" and nothing else.');
    await textarea.press('Enter');

    // Step 5: Wait for an assistant response to appear
    const assistantMessage = page.locator('[data-testid="message-assistant"]');
    await expect(assistantMessage.first()).toBeVisible({ timeout: 30000 });

    // Verify the response contains actual text content (not an error)
    const messageContent = page.locator('[data-testid="message-content"]');
    await expect(messageContent.last()).toBeVisible({ timeout: 30000 });

    // The response should contain text (not be empty)
    const responseText = await messageContent.last().textContent();
    expect(responseText).toBeTruthy();
    expect(responseText!.length).toBeGreaterThan(0);

    // Verify no error messages in the response
    expect(responseText!.toLowerCase()).not.toContain('incorrect api key');
    expect(responseText!.toLowerCase()).not.toContain('not found');

    await page.close();
  });
});
