import { helpCommand } from './cmd-help.js';
import { clearCommand } from './cmd-clear.js';
import { compactCommand } from './cmd-compact.js';
import type { SlashCommandDef } from './types.js';

const commands: SlashCommandDef[] = [helpCommand, clearCommand, compactCommand];

export { commands };
