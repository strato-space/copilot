export type ExpenseCurrency = 'RUB' | 'USD';

export interface ExpenseCategory {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ExpenseOperation {
  id: string;
  category_id: string;
  month: string;
  amount: number;
  currency: ExpenseCurrency;
  fx_used?: number;
  vendor?: string;
  comment?: string;
  attachments?: string[];
}

export const expenseCategories: ExpenseCategory[] = [
  { id: 'taxes', name: 'Налоги', is_active: true },
  { id: 'ai-subscription', name: 'AI подписки', is_active: true },
  { id: 'servers', name: 'Сервера', is_active: true },
];

export const expenseOperationsSeed: ExpenseOperation[] = [
  {
    id: 'op-ai-2026-01',
    category_id: 'ai-subscription',
    month: '2026-01',
    amount: 500,
    currency: 'USD',
    vendor: 'AI подписки',
  },
  {
    id: 'op-servers-2026-01',
    category_id: 'servers',
    month: '2026-01',
    amount: 12700,
    currency: 'RUB',
    vendor: 'Сервера',
  },
];

export const fxRatesByMonth: Record<string, number> = {
  '2026-01': 92.4,
  '2026-02': 93.1,
  '2026-03': 94.2,
};

export const convertToRub = (operation: ExpenseOperation, fallbackFx = 0): number => {
  if (operation.currency === 'RUB') {
    return operation.amount;
  }
  const fx = operation.fx_used ?? fallbackFx;
  if (!fx) {
    return 0;
  }
  return Math.round(operation.amount * fx);
};
