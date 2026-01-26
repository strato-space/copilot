import { create } from 'zustand';
import { EmployeeDirectoryEntry, employeeDirectory } from '../services/employeeDirectory';

const STORAGE_KEY = 'finopsEmployeeDirectory';

const loadEmployees = (): EmployeeDirectoryEntry[] => {
  if (typeof window === 'undefined') {
    return employeeDirectory;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return employeeDirectory;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return employeeDirectory;
    }
    return parsed as EmployeeDirectoryEntry[];
  } catch {
    return employeeDirectory;
  }
};

const persistEmployees = (employees: EmployeeDirectoryEntry[]): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(employees));
};

interface EmployeeState {
  employees: EmployeeDirectoryEntry[];
  setEmployees: (employees: EmployeeDirectoryEntry[]) => void;
  updateEmployee: (id: string, patch: Partial<EmployeeDirectoryEntry>) => void;
  addEmployee: (employee: EmployeeDirectoryEntry) => void;
  resetToSeed: () => void;
}

export const useEmployeeStore = create<EmployeeState>((set) => ({
  employees: loadEmployees(),
  setEmployees: (employees): void => {
    set({ employees });
    persistEmployees(employees);
  },
  updateEmployee: (id, patch): void => {
    set((state) => {
      const next = state.employees.map((employee) =>
        employee.id === id ? { ...employee, ...patch } : employee,
      );
      persistEmployees(next);
      return { employees: next };
    });
  },
  addEmployee: (employee): void => {
    set((state) => {
      const next = [...state.employees, employee];
      persistEmployees(next);
      return { employees: next };
    });
  },
  resetToSeed: (): void => {
    set({ employees: employeeDirectory });
    persistEmployees(employeeDirectory);
  },
}));
