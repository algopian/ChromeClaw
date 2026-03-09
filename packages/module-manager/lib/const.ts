const CHOICE_QUESTION = 'Choose feature to';
export const RECOVER_CHOICE_QUESTION = `${CHOICE_QUESTION} recover`;
export const DELETE_CHOICE_QUESTION = `${CHOICE_QUESTION} delete`;

export const DEFAULT_CHOICES = [
  { name: 'Background Script', value: 'background' },
  { name: 'New Tab Override', value: 'new-tab' },
  { name: 'DevTools (Include DevTools Panel)', value: 'devtools' },
  { name: 'Side Panel', value: 'side-panel' },
  { name: 'Options Page', value: 'options' },
  { name: 'All tests', value: 'tests' },
] as const;

export const DEFAULT_CHOICES_VALUES = DEFAULT_CHOICES.map(item => item.value);

export const HELP_EXAMPLES = [
  ['-d devtools options', 'Delete devtools and options'],
  ['--de background side-panel', 'Delete everything exclude background and side-panel'],
  ['-r options side-panel', 'Recover options and side-panel'],
  ['--re devtools new-tab', 'Recover everything exclude devtools and new-tab'],
] as const;

export const CLI_OPTIONS = [
  { alias: 'd', type: 'array', description: 'Delete specified features' },
  { alias: 'r', type: 'array', description: 'Recover specified features' },
  { alias: 'de', type: 'array', description: 'Delete all features except specified' },
  { alias: 're', type: 'array', description: 'Recover all features except specified' },
] as const;

export const MANAGER_ACTION_PROMPT_CONFIG = {
  message: 'Choose a tool',
  choices: [
    { name: 'Delete Feature', value: 'delete' },
    { name: 'Recover Feature', value: 'recover' },
  ],
} as const;

export const MODULE_CONFIG = {
  background: {
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
  },
  'new-tab': {
    chrome_url_overrides: {
      newtab: 'new-tab/index.html',
    },
  },
  devtools: {
    devtools_page: 'devtools/index.html',
  },
  'side-panel': {
    side_panel: {
      default_path: 'side-panel/index.html',
    },
    permissions: ['sidePanel'],
  },
  options: {
    options_page: 'options/index.html',
  },
} as const;

export const EXIT_PROMPT_ERROR = 'ExitPromptError';
