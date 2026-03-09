import type { Page } from '@playwright/test';

export class OptionsPage {
  constructor(
    private page: Page,
    private extensionId: string,
  ) {}

  async navigate() {
    await this.page.goto(`chrome-extension://${this.extensionId}/options/index.html`);
  }

  async waitForLoad() {
    await this.page.waitForLoadState('domcontentloaded');
  }
}
