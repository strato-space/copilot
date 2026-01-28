import { create } from 'zustand';
import { apiClient } from '../services/api';

export type GuideSource = 'automation' | 'manual' | 'unavailable' | 'unknown';

export interface GuideIndexItem {
  name: string;
  module?: string;
  title?: string;
  source?: GuideSource;
  count?: number;
  updated_at?: string | null;
}

export interface GuideDirectoryState<T = Record<string, unknown>> {
  items: T[];
  source: GuideSource;
  updated_at: string | null;
}

interface GuideApiEnvelope<T> {
  data?: T;
  error?: { message?: string } | null;
}

interface GuideState {
  index: GuideIndexItem[];
  indexLoading: boolean;
  indexError: string | null;
  directories: Record<string, GuideDirectoryState>;
  directoryLoading: Record<string, boolean>;
  directoryError: Record<string, string | null>;
  fetchIndex: () => Promise<void>;
  fetchDirectory: (name: string) => Promise<void>;
}

const normalizeSource = (value: unknown): GuideSource => {
  if (value === 'automation' || value === 'manual' || value === 'unavailable' || value === 'unknown') {
    return value;
  }
  return 'unknown';
};

const emptyDirectory = (): GuideDirectoryState => ({
  items: [],
  source: 'unknown',
  updated_at: null,
});

export const useGuideStore = create<GuideState>((set, get): GuideState => ({
  index: [],
  indexLoading: false,
  indexError: null,
  directories: {},
  directoryLoading: {},
  directoryError: {},
  fetchIndex: async (): Promise<void> => {
    set({ indexLoading: true, indexError: null });
    try {
      const response = await apiClient.get<GuideApiEnvelope<GuideIndexItem[] | { items?: GuideIndexItem[] }>>(
        '/guide/index',
      );
      const payload = response.data?.data;
      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
      set({ index: items, indexLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      set({ indexError: message, indexLoading: false });
    }
  },
  fetchDirectory: async (name: string): Promise<void> => {
    set((state) => ({
      directoryLoading: { ...state.directoryLoading, [name]: true },
      directoryError: { ...state.directoryError, [name]: null },
    }));
    try {
      const response = await apiClient.get<
        GuideApiEnvelope<GuideDirectoryState | { items?: Record<string, unknown>[]; source?: string; updated_at?: string }>
      >(`/guide/directory/${name}`);
      const payload = response.data?.data;
      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
      const source = normalizeSource(
        !Array.isArray(payload) && payload && 'source' in payload ? payload.source : 'unknown',
      );
      const updated_at =
        !Array.isArray(payload) && payload && 'updated_at' in payload && typeof payload.updated_at === 'string'
          ? payload.updated_at
          : null;
      set((state) => ({
        directories: {
          ...state.directories,
          [name]: {
            items,
            source,
            updated_at,
          },
        },
        directoryLoading: { ...state.directoryLoading, [name]: false },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      set((state) => ({
        directories: state.directories[name] ? state.directories : { ...state.directories, [name]: emptyDirectory() },
        directoryError: { ...state.directoryError, [name]: message },
        directoryLoading: { ...state.directoryLoading, [name]: false },
      }));
    }
  },
}));
