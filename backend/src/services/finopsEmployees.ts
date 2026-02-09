import { type Collection } from 'mongodb';
import { getDb } from './db.js';
import { COLLECTIONS } from '../constants.js';

export interface PerformerDocument {
    _id: unknown;
    name?: string;
    real_name?: string;
    role?: string;
    team?: string;
    monthly_salary?: number;
    salary_currency?: 'RUB' | 'USD';
    monthly_salary_by_month?: Record<string, number>;
    is_deleted?: boolean;
    is_banned?: boolean;
}

export interface FinopsEmployee {
    id: string;
    name: string;
    role: string;
    team: string;
    monthlySalary: number;
    monthlySalaryByMonth?: Record<string, number>;
    costRate: number;
}

const getPerformersCollection = (): Collection<PerformerDocument> =>
    getDb().collection<PerformerDocument>(COLLECTIONS.PERFORMERS);

export interface ListEmployeesParams {
    months: string[];
    fxRatesByMonth: Record<string, number>;
}

const convertToRub = (
    amount: number,
    currency: 'RUB' | 'USD' | undefined,
    month: string,
    fxRatesByMonth: Record<string, number>,
): number => {
    if (currency !== 'USD') {
        return amount;
    }
    const rate = fxRatesByMonth[month] ?? 0;
    if (!rate) {
        return 0;
    }
    return Math.round(amount * rate);
};

export const listFinopsEmployees = async ({ months, fxRatesByMonth }: ListEmployeesParams): Promise<FinopsEmployee[]> => {
    const performers = await getPerformersCollection()
        .find({ is_deleted: { $ne: true }, is_banned: { $ne: true } })
        .toArray();

    return performers.map((performer) => {
        const name = performer.name ?? performer.real_name ?? 'Без имени';
        const role = performer.role ?? '';
        const team = performer.team ?? '';

        let monthlySalaryByMonth: Record<string, number> | undefined = performer.monthly_salary_by_month;
        if (!monthlySalaryByMonth && typeof performer.monthly_salary === 'number') {
            monthlySalaryByMonth = months.reduce<Record<string, number>>((acc, month) => {
                acc[month] = convertToRub(performer.monthly_salary ?? 0, performer.salary_currency, month, fxRatesByMonth);
                return acc;
            }, {});
        }

        const primaryMonth = months[0];
        const monthlySalary =
            (primaryMonth && monthlySalaryByMonth ? monthlySalaryByMonth[primaryMonth] : undefined)
            ?? performer.monthly_salary
            ?? 0;

        const base: FinopsEmployee = {
            id: String(performer._id),
            name,
            role,
            team,
            monthlySalary,
            costRate: 0,
        };
        if (monthlySalaryByMonth) {
            base.monthlySalaryByMonth = monthlySalaryByMonth;
        }
        return base;
    });
};
