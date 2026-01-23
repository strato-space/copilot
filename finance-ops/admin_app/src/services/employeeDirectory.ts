export interface EmployeeDirectoryEntry {
  id: string;
  name: string;
  role: string;
  team: string;
  monthlySalary: number;
  costRate: number;
}

export const employeeDirectory: EmployeeDirectoryEntry[] = [
  {
    id: 'emp-ivan-p',
    name: 'Иван П.',
    role: 'Senior Dev',
    team: 'Platform',
    monthlySalary: 320000,
    costRate: 2000,
  },
  {
    id: 'emp-maria-s',
    name: 'Мария С.',
    role: 'PM',
    team: 'Delivery',
    monthlySalary: 260000,
    costRate: 1600,
  },
  {
    id: 'emp-alex-k',
    name: 'Алексей К.',
    role: 'Analyst',
    team: 'Analytics',
    monthlySalary: 240000,
    costRate: 1500,
  },
  {
    id: 'emp-nina-v',
    name: 'Нина В.',
    role: 'QA',
    team: 'Quality',
    monthlySalary: 180000,
    costRate: 1200,
  },
];
