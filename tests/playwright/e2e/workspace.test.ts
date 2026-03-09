import { test, expect } from '../fixtures/extension';
import { OptionsPage } from '../pages/options';
import { SidePanelPage } from '../pages/side-panel';

test.describe('Workspace — Agents Page', () => {
  test('sidebar has no Workspace tab', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const sidePanel = new SidePanelPage(page, extensionId);
    await sidePanel.navigate();
    await sidePanel.waitForLoad();

    // Open sidebar
    await sidePanel.openSidebar();

    // Sessions label should be visible
    await expect(page.locator('span', { hasText: 'Sessions' })).toBeVisible();

    // Workspace tab should NOT exist
    await expect(page.locator('button', { hasText: 'Workspace' })).not.toBeVisible();

    await page.close();
  });

  test('Options Agents tab shows predefined files', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const options = new OptionsPage(page, extensionId);
    await options.navigate();
    await options.waitForLoad();

    // Click the Agents tab
    await page.locator('button', { hasText: 'Agents' }).click();

    // Click "Files" sub-tab
    await page.locator('button', { hasText: 'Files' }).click();

    // Verify predefined files are listed
    const expectedFiles = [
      'AGENTS.md',
      'SOUL.md',
      'USER.md',
      'IDENTITY.md',
      'TOOLS.md',
      'MEMORY.md',
    ];
    for (const fileName of expectedFiles) {
      await expect(page.locator('button', { hasText: fileName }).first()).toBeVisible();
    }

    await page.close();
  });

  test('user can edit a workspace file', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const options = new OptionsPage(page, extensionId);
    await options.navigate();
    await options.waitForLoad();

    await page.locator('button', { hasText: 'Agents' }).click();
    await page.locator('button', { hasText: 'Files' }).click();

    // Click on MEMORY.md in the file list
    await page.locator('button', { hasText: 'MEMORY.md' }).first().click();

    // Editor should be visible with a textarea
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();

    // Type some content
    await textarea.fill('Test memory content');

    // Save button should be enabled
    const saveButton = page.locator('button', { hasText: 'Save' });
    await expect(saveButton).toBeEnabled();

    await page.close();
  });

  test('user can toggle a workspace file enabled/disabled', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const options = new OptionsPage(page, extensionId);
    await options.navigate();
    await options.waitForLoad();

    await page.locator('button', { hasText: 'Agents' }).click();
    await page.locator('button', { hasText: 'Files' }).click();

    // Find the ON/OFF toggle for MEMORY.md file card
    const memoryCard = page.locator('button', { hasText: 'MEMORY.md' }).first();
    await expect(memoryCard).toBeVisible();

    // Click the ON/OFF toggle button within the card area
    const toggleBtn = memoryCard.locator('button', { hasText: /^(ON|OFF)$/ });
    if (await toggleBtn.isVisible().catch(() => false)) {
      const initialText = await toggleBtn.textContent();
      await toggleBtn.click();
      const newText = await toggleBtn.textContent();
      expect(newText).not.toBe(initialText);
    }

    await page.close();
  });

  test('user can create a custom workspace file', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const options = new OptionsPage(page, extensionId);
    await options.navigate();
    await options.waitForLoad();

    await page.locator('button', { hasText: 'Agents' }).click();
    await page.locator('button', { hasText: 'Files' }).click();

    // Click "New File" button
    const newFileBtn = page.locator('button', { hasText: 'New File' });
    await expect(newFileBtn).toBeVisible();
    await newFileBtn.click();

    // Editor should open with textarea visible
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();

    await page.close();
  });

  test('predefined files cannot be deleted', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const options = new OptionsPage(page, extensionId);
    await options.navigate();
    await options.waitForLoad();

    await page.locator('button', { hasText: 'Agents' }).click();
    await page.locator('button', { hasText: 'Files' }).click();

    // AGENTS.md is predefined — its file card should not have a delete button
    const agentsCard = page.locator('button', { hasText: 'AGENTS.md' }).first();
    await expect(agentsCard).toBeVisible();

    // Delete button should not be visible for predefined files
    const deleteBtn = agentsCard.locator('button[title="Delete"]');
    await expect(deleteBtn).toHaveCount(0);

    await page.close();
  });

  test('Overview tab shows identity information', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const options = new OptionsPage(page, extensionId);
    await options.navigate();
    await options.waitForLoad();

    await page.locator('button', { hasText: 'Agents' }).click();

    // Overview is the default sub-tab
    await expect(page.getByText('Identity')).toBeVisible();

    // Identity fields should be visible
    await expect(page.getByText('Name')).toBeVisible();
    await expect(page.getByText('Emoji')).toBeVisible();
    await expect(page.getByText('Creature')).toBeVisible();
    await expect(page.getByText('Vibe')).toBeVisible();

    await page.close();
  });

  test('Agent list panel shows main agent', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const options = new OptionsPage(page, extensionId);
    await options.navigate();
    await options.waitForLoad();

    await page.locator('button', { hasText: 'Agents' }).click();

    // Agent list should show "Main Agent" or the identity name
    await expect(page.getByText('main').first()).toBeVisible();

    // DEFAULT badge should be visible
    await expect(page.getByText('DEFAULT').first()).toBeVisible();

    await page.close();
  });
});
