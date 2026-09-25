import type { TrashItem } from '@letfer/shared';
import { apiFetch } from './client.js';

export const trashApi = {
  list: (projectId: string) => apiFetch<TrashItem[]>(`/projects/${projectId}/trash`),
};
