import { commands } from './registry.js';
import { t } from '@extension/i18n';
import type { SlashCommandDef } from './types.js';

const helpCommand: SlashCommandDef = {
  name: 'help',
  description: 'Show available slash commands',
  execute: async ctx => {
    const text = commands.map(c => `/${c.name} — ${c.description}`).join('\n');
    ctx.appendSystemMessage(`__cmd_response__help_${Date.now()}`, `${t('slash_availableCommands')}\n${text}`);
    ctx.clearInput();
  },
};

export { helpCommand };
