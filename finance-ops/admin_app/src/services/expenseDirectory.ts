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
  { id: 'bonus', name: 'Бонусы', is_active: true },
  { id: 'ai-subscription', name: 'AI подписка', is_active: true },
];

export const expenseOperationsSeed: ExpenseOperation[] = [
  {
    id: 'op-1',
    category_id: 'taxes',
    month: '2026-01',
    amount: 160000,
    currency: 'RUB',
    vendor: 'ФНС',
  },
  {
    id: 'op-2',
    category_id: 'bonus',
    month: '2026-01',
    amount: 80000,
    currency: 'RUB',
    comment: 'Бонусы за Q4',
  },
  {
    id: 'op-3',
    category_id: 'ai-subscription',
    month: '2026-01',
    amount: 1200,
    currency: 'USD',
    fx_used: 92.4,
    vendor: 'OpenAI',
  },
  {
    id: 'op-4',
    category_id: 'ai-subscription',
    month: '2026-02',
    amount: 1200,
    currency: 'USD',
    fx_used: 93.1,
    vendor: 'OpenAI',
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
