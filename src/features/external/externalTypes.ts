import type { ExternalRequestV1, ExternalRequestResult } from '../../api/nativeBridge';

export type { ExternalRequestV1, ExternalRequestResult };

export interface ExternalRequestLogEntry {
  id: string;
  requestId: string;
  action: 'add' | 'print';
  pathsCount: number;
  favoriteId?: string;
  status: 'accepted' | 'completed' | 'rejected' | 'failed';
  message: string;
  timestamp: number;
}
