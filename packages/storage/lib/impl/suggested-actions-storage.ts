import { createStorage, StorageEnum } from '../base/index.js';

interface SuggestedAction {
  id: string;
  label: string;
  prompt: string;
}

const defaultSuggestedActions: SuggestedAction[] = [
  {
    id: '1',
    label: 'What is the weather in San Francisco?',
    prompt: 'What is the weather in San Francisco?',
  },
  { id: '2', label: 'Help me write a Python script', prompt: 'Help me write a Python script' },
  {
    id: '3',
    label: 'Explain quantum computing simply',
    prompt: 'Explain quantum computing simply',
  },
  { id: '4', label: 'What are the latest AI trends?', prompt: 'What are the latest AI trends?' },
];

const suggestedActionsStorage = createStorage<SuggestedAction[]>(
  'suggested-actions',
  defaultSuggestedActions,
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export type { SuggestedAction };
export { suggestedActionsStorage, defaultSuggestedActions };
