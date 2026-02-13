import { create } from 'zustand';
import dayjs from 'dayjs';
import { apiClient } from '../services/api';
import {
  type PlanFactGridResponse,
  type PlanFactMonthCell,
  type PlanFactProjectRow,
} from '../services/types';
import { mockPlanFact } from '../services/mockPlanFact';

interface PlanFactState {
  data: PlanFactGridResponse | null;
  loading: boolean;
  error: string | null;
  usingMock: boolean;
  year: number;
  focusMonth: string;
  forecastVersionId: string;
  dateRange: [string, string];
  fetchPlanFact: () => Promise<void>;
  updateProjectMonth: (
    customerId: string,
    projectId: string,
    month: string,
    values: PlanFactMonthCell,
  ) => void;
  setDateRange: (range: [string, string]) => void;
  setYear: (year: number) => void;
  setFocusMonth: (month: string) => void;
  setForecastVersionId: (value: string) => void;
  setUsingMock: (value: boolean) => void;
}

const now = dayjs();
const initialRangeStart = now.format('YYYY-MM');
const initialRangeEnd = now.format('YYYY-MM');

const clonePlanFact = (data: PlanFactGridResponse): PlanFactGridResponse => {
  if (typeof structuredClone === 'function') {
    return structuredClone(data);
  }
  return JSON.parse(JSON.stringify(data)) as PlanFactGridResponse;
};

const emptyCell = (): PlanFactMonthCell => ({
  fact_rub: 0,
  fact_hours: 0,
  forecast_rub: 0,
  forecast_hours: 0,
});

export const usePlanFactStore = create<PlanFactState>((set, get): PlanFactState => ({
  data: null,
  loading: false,
  error: null,
  usingMock: false,
  year: now.year(),
  focusMonth: now.format('YYYY-MM'),
  forecastVersionId: 'baseline',
  dateRange: [initialRangeStart, initialRangeEnd],
  fetchPlanFact: async (): Promise<void> => {
    const { year, focusMonth, forecastVersionId, usingMock } = get();
    set({ loading: true, error: null });
    try {
      if (usingMock) {
        set({ data: clonePlanFact(mockPlanFact), loading: false });
        return;
      }
      const response = await apiClient.get<{
        data: PlanFactGridResponse;
        error: { message: string } | null;
      }>('/plan-fact', {
        params: {
          year,
          focus_month: focusMonth,
          forecast_version_id: forecastVersionId,
        },
      });
      set({ data: response.data.data, loading: false, usingMock: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      set((state) => ({
        error: message,
        loading: false,
        // Keep the last known data instead of replacing with mock values.
        data: state.data,
      }));
    }
  },
  updateProjectMonth: (
    customerId: string,
    projectId: string,
    month: string,
    values: PlanFactMonthCell,
  ): void => {
    const current = get().data;
    if (!current) {
      return;
    }
    const nextCustomers = current.customers.map((customer): PlanFactGridResponse['customers'][number] => {
      if (customer.customer_id !== customerId) {
        return customer;
      }
      const nextProjects = customer.projects.map((project): PlanFactProjectRow => {
        if (project.project_id !== projectId) {
          return project;
        }
        const prevCell = project.months[month] ?? emptyCell();
        const nextCell: PlanFactMonthCell = {
          ...prevCell,
          ...values,
        };
        return {
          ...project,
          months: {
            ...project.months,
            // Merge to avoid wiping sibling fields (e.g. fact_comment vs forecast_comment).
            [month]: nextCell,
          },
        };
      });
      const totals = nextProjects.reduce<PlanFactMonthCell>(
        (acc: PlanFactMonthCell, project: PlanFactProjectRow): PlanFactMonthCell => {
          const cell = project.months[month] ?? emptyCell();
          return {
            fact_rub: acc.fact_rub + cell.fact_rub,
            fact_hours: acc.fact_hours + cell.fact_hours,
            forecast_rub: acc.forecast_rub + cell.forecast_rub,
            forecast_hours: acc.forecast_hours + cell.forecast_hours,
          };
        },
        emptyCell(),
      );
      return {
        ...customer,
        projects: nextProjects,
        totals_by_month: {
          ...customer.totals_by_month,
          [month]: totals,
        },
      };
    });
    set({
      data: {
        ...current,
        customers: nextCustomers,
      },
    });
  },
  setDateRange: (range: [string, string]): void => set({ dateRange: range }),
  setYear: (year: number): void => set({ year }),
  setFocusMonth: (month: string): void => set({ focusMonth: month }),
  setForecastVersionId: (value: string): void => set({ forecastVersionId: value }),
  setUsingMock: (value: boolean): void => {
    if (value) {
      set({ usingMock: true, data: clonePlanFact(mockPlanFact), error: null });
      return;
    }
    set({ usingMock: false });
  },
}));
