import { create } from 'zustand';
import { type ExpenseCategory, type ExpenseOperation } from '../services/expenseDirectory';

interface ExpensesState {
  categories: ExpenseCategory[];
  operations: ExpenseOperation[];
  fxRatesByMonth: Record<string, number>;
  setCategories: (categories: ExpenseCategory[]) => void;
  setOperations: (operations: ExpenseOperation[]) => void;
  setFxRatesByMonth: (rates: Record<string, number>) => void;
  addCategory: (category: ExpenseCategory) => void;
  addOperation: (operation: ExpenseOperation) => void;
  updateOperation: (operation: ExpenseOperation) => void;
  deleteOperation: (operationId: string) => void;
}

export const useExpensesStore = create<ExpensesState>((set) => ({
  categories: [],
  operations: [],
  fxRatesByMonth: {},
  setCategories: (categories): void => {
    set({ categories });
  },
  setOperations: (operations): void => {
    set({ operations });
  },
  setFxRatesByMonth: (rates): void => {
    set({ fxRatesByMonth: rates });
  },
  addCategory: (category): void => {
    set((state) => ({ categories: [...state.categories, category] }));
  },
  addOperation: (operation): void => {
    set((state) => ({ operations: [...state.operations, operation] }));
  },
  updateOperation: (operation): void => {
    set((state) => ({
      operations: state.operations.map((item) => (item.id === operation.id ? operation : item)),
    }));
  },
  deleteOperation: (operationId): void => {
    set((state) => ({
      operations: state.operations.filter((item) => item.id !== operationId),
    }));
  },
}));
