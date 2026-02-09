import { create } from 'zustand';
interface MonthCloseState {
  closedMonths: string[];
  isClosed: (month: string) => boolean;
  setClosedMonths: (months: string[]) => void;
}

export const useMonthCloseStore = create<MonthCloseState>((set, get) => ({
  closedMonths: [],
  isClosed: (month: string): boolean => get().closedMonths.includes(month),
  setClosedMonths: (months): void => {
    set({ closedMonths: months });
  },
}));
