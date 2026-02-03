import { create } from 'zustand';
import { apiClient } from '../services/api';

interface FundState {
  commentsByMonth: Record<string, string>;
  loading: boolean;
  error: string | null;
  fetchComments: () => Promise<void>;
  updateComment: (month: string, comment: string) => Promise<void>;
}

const defaultComments: Record<string, string> = {
  '2025-11': 'Баланс фонда за 2025',
};

const mergeComments = (comments: Record<string, string>): Record<string, string> => ({
  ...defaultComments,
  ...comments,
});

export const useFundStore = create<FundState>((set, get) => ({
  commentsByMonth: { ...defaultComments },
  loading: false,
  error: null,
  fetchComments: async (): Promise<void> => {
    if (get().loading) {
      return;
    }
    set({ loading: true, error: null });
    try {
      const response = await apiClient.get('/fund/comments');
      const raw = response.data?.data ?? {};
      const data =
        typeof raw === 'object' && raw !== null && !Array.isArray(raw)
          ? (raw as Record<string, string>)
          : {};
      set({ commentsByMonth: mergeComments(data), loading: false, error: null });
    } catch (error) {
      set({
        loading: false,
        error: 'Не удалось загрузить комментарии фонда',
        commentsByMonth: { ...defaultComments },
      });
    }
  },
  updateComment: async (month, comment): Promise<void> => {
    set((state) => ({
      commentsByMonth: {
        ...state.commentsByMonth,
        [month]: comment,
      },
      error: null,
    }));
    try {
      await apiClient.put(`/fund/comments/${month}`, { comment });
    } catch (error) {
      set({ error: 'Не удалось сохранить комментарий фонда' });
    }
  },
}));
