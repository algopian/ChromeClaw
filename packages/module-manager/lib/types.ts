import type { DEFAULT_CHOICES } from './const.js';
import type { select } from '@inquirer/prompts';

export type ChoiceType = (typeof DEFAULT_CHOICES)[number];
export type ChoicesType = ChoiceType[];
export type ModuleNameType = ChoiceType['value'] | 'devtools-panel';
export type InputConfigType = Parameters<typeof select>[0];

export interface ICLIOptions {
  action: 'delete' | 'recover';
  targets: ModuleNameType[];
}

export type CliEntriesType = [string, (string | number)[]][];
export type CliActionType = 'delete' | 'recover';
