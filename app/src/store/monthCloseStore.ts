import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface MonthCloseLogEntry {
  month: string;
  action: 'close' | 'open';
  timestamp: string;
}

interface MonthCloseState {
  closedMonths: string[];
  log: MonthCloseLogEntry[];
  isClosed: (month: string) => boolean;
  toggleMonth: (month: string) => void;
}

export const useMonthCloseStore = create<MonthCloseState>()(
  persist(
    (set, get) => ({
      closedMonths: [],
      log: [],
      isClosed: (month: string): boolean => get().closedMonths.includes(month),
      toggleMonth: (month: string): void => {
        const isClosed = get().closedMonths.includes(month);
        const nextClosed = isClosed
          ? get().closedMonths.filter((item) => item !== month)
          : [...get().closedMonths, month];
        const nextLog: MonthCloseLogEntry = {
          month,
          action: isClosed ? 'open' : 'close',
          timestamp: new Date().toISOString(),
        };
        set({
          closedMonths: nextClosed,
          log: [nextLog, ...get().log].slice(0, 200),
        });
      },
    }),
    {
      name: 'finops-closed-months',
      version: 1,
      partialize: (state) => ({
        closedMonths: state.closedMonths,
        log: state.log,
      }),
    },
  ),
);
