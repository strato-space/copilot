import { fxRatesByMonth } from './expenseDirectory';

export interface EmployeeDirectoryEntry {
  id: string;
  name: string;
  role: string;
  team: string;
  monthlySalary: number;
  monthlySalaryByMonth?: Record<string, number>;
  costRate: number;
}

export const SALARY_MONTHS = ['2026-01', '2026-02', '2026-03'] as const;
const RU_WORK_HOURS_BY_MONTH: Record<string, number> = {
  '2026-01': 120,
  '2026-02': 152,
  '2026-03': 168,
};

export const getWorkingHoursRuMonth = (month: string): number => {
  return RU_WORK_HOURS_BY_MONTH[month] ?? 0;
};

export const getEmployeeMonthlySalary = (employee: EmployeeDirectoryEntry, month: string): number => {
  if (employee.monthlySalaryByMonth) {
    return employee.monthlySalaryByMonth[month] ?? 0;
  }
  return employee.monthlySalary;
};

export const getEmployeeMonthlyHours = (employee: EmployeeDirectoryEntry, month: string): number => {
  const salary = getEmployeeMonthlySalary(employee, month);
  if (!salary) {
    return 0;
  }
  return getWorkingHoursRuMonth(month);
};

export const getEmployeeCostRate = (employee: EmployeeDirectoryEntry, month: string): number => {
  const salary = getEmployeeMonthlySalary(employee, month);
  const hours = getEmployeeMonthlyHours(employee, month);
  if (!salary || !hours) {
    return 0;
  }
  return Math.round(salary / hours);
};

const toRub = (amount: number, currency: 'RUB' | 'USD', month: string): number => {
  if (currency === 'RUB') {
    return amount;
  }
  const rate = fxRatesByMonth[month] ?? 0;
  if (!rate) {
    return 0;
  }
  return Math.round(amount * rate);
};

const buildMonthlySalary = (amount: number, currency: 'RUB' | 'USD'): Record<string, number> =>
  SALARY_MONTHS.reduce<Record<string, number>>((acc, month) => {
    acc[month] = toRub(amount, currency, month);
    return acc;
  }, {});
const primaryMonth = SALARY_MONTHS[0];
const calcCostRate = (salaryRub: number): number =>
  getWorkingHoursRuMonth(primaryMonth) ? Math.round(salaryRub / getWorkingHoursRuMonth(primaryMonth)) : 0;

export const employeeDirectory: EmployeeDirectoryEntry[] = [
  {
    id: 'emp-marat-kabirov',
    name: 'Марат Кабиров',
    role: 'Product Designer',
    team: 'Team',
    monthlySalary: toRub(130000, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(130000, 'RUB'),
    costRate: calcCostRate(toRub(130000, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-yuriy-kozhevnikov',
    name: 'Юрий Кожевников',
    role: 'Product Designer',
    team: 'Strato',
    monthlySalary: toRub(0, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(0, 'RUB'),
    costRate: calcCostRate(toRub(0, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-nikita-renye',
    name: 'Никита Ренье',
    role: 'Product Designer',
    team: 'Strato',
    monthlySalary: toRub(150000, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(150000, 'RUB'),
    costRate: calcCostRate(toRub(150000, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-ilya-kalyashmanov',
    name: 'Илья Каляшманов',
    role: 'Product Designer',
    team: 'Team',
    monthlySalary: toRub(100000, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(100000, 'RUB'),
    costRate: calcCostRate(toRub(100000, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-egor-nazarevskiy',
    name: 'Егор Назаревский',
    role: 'Product Designer',
    team: 'Team',
    monthlySalary: toRub(100000, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(100000, 'RUB'),
    costRate: calcCostRate(toRub(100000, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-andrey-sergeev',
    name: 'Андрей Сергеев',
    role: 'Product Designer',
    team: 'Agent',
    monthlySalary: toRub(0, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(0, 'RUB'),
    costRate: calcCostRate(toRub(0, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-vyacheslav-danchenko',
    name: 'Вячеслав Данченко',
    role: 'Product Designer',
    team: 'Agent',
    monthlySalary: toRub(0, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(0, 'RUB'),
    costRate: calcCostRate(toRub(0, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-erbol-tastanbekov',
    name: 'Ербол Тастанбеков',
    role: 'Product Designer',
    team: 'Team',
    monthlySalary: toRub(700, 'USD', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(700, 'USD'),
    costRate: calcCostRate(toRub(700, 'USD', primaryMonth)),
  },
  {
    id: 'emp-ekaterina-kozhevnikova',
    name: 'Екатерина Кожевникова',
    role: 'Product Designer',
    team: 'Agent',
    monthlySalary: toRub(0, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(0, 'RUB'),
    costRate: calcCostRate(toRub(0, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-larin-vyacheslav',
    name: 'Ларин Вячеслав',
    role: 'Product Designer',
    team: 'Agent',
    monthlySalary: toRub(0, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(0, 'RUB'),
    costRate: calcCostRate(toRub(0, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-varzhavka-tatyana',
    name: 'Варжавка Татьяна',
    role: 'Product Designer',
    team: 'Agent',
    monthlySalary: toRub(0, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(0, 'RUB'),
    costRate: calcCostRate(toRub(0, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-polina-gramm',
    name: 'Полина Грамм',
    role: 'Product Designer',
    team: 'Agent',
    monthlySalary: toRub(0, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(0, 'RUB'),
    costRate: calcCostRate(toRub(0, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-anton-b',
    name: 'Антон Б.',
    role: 'Product Designer',
    team: 'Strato',
    monthlySalary: toRub(100000, 'RUB', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(100000, 'RUB'),
    costRate: calcCostRate(toRub(100000, 'RUB', primaryMonth)),
  },
  {
    id: 'emp-valeriy-s',
    name: 'Валерий С.',
    role: 'Product Designer',
    team: 'Strato',
    monthlySalary: toRub(1200, 'USD', primaryMonth),
    monthlySalaryByMonth: buildMonthlySalary(1200, 'USD'),
    costRate: calcCostRate(toRub(1200, 'USD', primaryMonth)),
  },
];
