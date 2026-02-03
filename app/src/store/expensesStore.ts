import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  expenseCategories as expenseCategoriesSeed,
  expenseOperationsSeed,
  type ExpenseCategory,
  type ExpenseOperation,
} from '../services/expenseDirectory';

interface ExpensesState {
  categories: ExpenseCategory[];
  operations: ExpenseOperation[];
  setCategories: (categories: ExpenseCategory[]) => void;
  setOperations: (operations: ExpenseOperation[]) => void;
  addCategory: (category: ExpenseCategory) => void;
  addOperation: (operation: ExpenseOperation) => void;
  updateOperation: (operation: ExpenseOperation) => void;
  deleteOperation: (operationId: string) => void;
}

export const useExpensesStore = create<ExpensesState>()(
  persist(
    (set) => ({
      categories: expenseCategoriesSeed,
      operations: expenseOperationsSeed,
      setCategories: (categories): void => {
        set({ categories });
      },
      setOperations: (operations): void => {
        set({ operations });
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
    }),
    {
      name: 'finops-expenses-store',
      version: 1,
      partialize: (state) => ({
        categories: state.categories,
        operations: state.operations,
      }),
    },
  ),
);
