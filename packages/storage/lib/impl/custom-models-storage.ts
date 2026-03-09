import { createStorage, StorageEnum } from '../base/index.js';
import type { DbChatModel } from './chat-db.js';

export const customModelsStorage = createStorage<DbChatModel[]>('custom-models', [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});
