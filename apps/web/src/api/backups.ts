import type { BackupGeneration, RestoreBackupInput } from '@letfer/shared';
import { apiFetch } from './client.js';

export const backupsApi = {
  list: () => apiFetch<BackupGeneration[]>('/admin/backups'),
  create: () => apiFetch<BackupGeneration>('/admin/backups', { method: 'POST' }),
  restore: (input: RestoreBackupInput) =>
    apiFetch<BackupGeneration>('/admin/backups/restore', { method: 'POST', body: input }),
};
