import { create } from 'zustand';

export interface FxRate {
  month: string;
  rate: number;
  source: string;
  base: number;
}

interface FxState {
  rates: Record<string, FxRate>;
  setRate: (month: string, rate: number, source: string) => void;
  setRates: (items: FxRate[]) => void;
  getFactor: (month: string) => number;
}

const initialRates: FxRate[] = [
  { month: '2026-01', rate: 92.4, source: 'ЦБ РФ', base: 92.4 },
  { month: '2026-02', rate: 93.1, source: 'ЦБ РФ', base: 93.1 },
];

export const useFxStore = create<FxState>((set, get): FxState => ({
  rates: initialRates.reduce<Record<string, FxRate>>((acc, item) => {
    acc[item.month] = item;
    return acc;
  }, {}),
  setRate: (month: string, rate: number, source: string): void => {
    set((state) => {
      const existing = state.rates[month];
      const base = existing?.base ?? rate;
      return {
        rates: {
          ...state.rates,
          [month]: {
            month,
            rate,
            source,
            base,
          },
        },
      };
    });
  },
  setRates: (items: FxRate[]): void => {
    set(() => ({
      rates: items.reduce<Record<string, FxRate>>((acc, item) => {
        acc[item.month] = item;
        return acc;
      }, {}),
    }));
  },
  getFactor: (month: string): number => {
    const item = get().rates[month];
    if (!item || !item.base) {
      return 1;
    }
    return item.rate / item.base;
  },
}));
