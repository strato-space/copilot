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
