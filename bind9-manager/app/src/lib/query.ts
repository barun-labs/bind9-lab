import type { RecordType, SyncState } from '../types/entities';

export interface TableState {
  type?: RecordType;
  status?: SyncState;
  q?: string;
  page: number;
  size: number;
  sort?: string;
  recordId?: string;
}

export function parseQuery(search: string): TableState {
  const params = new URLSearchParams(search);
  const state: TableState = {
    page: 1,
    size: 50,
  };

  const pageStr = params.get('page');
  if (pageStr !== null) {
    const pageNum = parseInt(pageStr, 10);
    if (!Number.isNaN(pageNum) && pageNum > 0) {
      state.page = pageNum;
    }
  }

  const sizeStr = params.get('size');
  if (sizeStr !== null) {
    const sizeNum = parseInt(sizeStr, 10);
    if (!Number.isNaN(sizeNum) && sizeNum > 0) {
      state.size = sizeNum;
    }
  }

  const type = params.get('type');
  if (type) {
    state.type = type as RecordType;
  }

  const status = params.get('status');
  if (status) {
    state.status = status as SyncState;
  }

  const q = params.get('q');
  if (q) {
    state.q = q;
  }

  const sort = params.get('sort');
  if (sort) {
    state.sort = sort;
  }

  const recordId = params.get('recordId');
  if (recordId) {
    state.recordId = recordId;
  }

  return state;
}

export function toSearch(state: TableState): string {
  const params = new URLSearchParams();

  if (state.type) {
    params.set('type', state.type);
  }
  if (state.status) {
    params.set('status', state.status);
  }
  if (state.q) {
    params.set('q', state.q);
  }
  if (state.page !== undefined && state.page !== 1) {
    params.set('page', String(state.page));
  }
  if (state.size !== undefined && state.size !== 50) {
    params.set('size', String(state.size));
  }
  if (state.sort) {
    params.set('sort', state.sort);
  }
  if (state.recordId) {
    params.set('recordId', state.recordId);
  }

  return params.toString();
}
