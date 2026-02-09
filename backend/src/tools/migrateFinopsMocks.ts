import { connectDb, closeDb, getDb } from '../services/db.js';
import { COLLECTIONS } from '../constants.js';

const expenseCategories = [
    { id: 'taxes', name: 'Налоги', is_active: true },
    { id: 'ai-subscription', name: 'AI подписки', is_active: true },
    { id: 'servers', name: 'Сервера', is_active: true },
];

interface MockExpenseOperation {
    id: string;
    category_id: string;
    month: string;
    amount: number;
    currency: 'RUB' | 'USD';
    fx_used?: number;
    vendor?: string;
    comment?: string;
    attachments?: string[];
}

const expenseOperationsSeed: MockExpenseOperation[] = [
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

const fxRatesByMonth: Record<string, number> = {
    '2026-01': 92.4,
    '2026-02': 93.1,
    '2026-03': 94.2,
};

const employeeDirectory = [
    {
        id: 'emp-marat-kabirov',
        name: 'Марат Кабиров',
        role: 'Product Designer',
        team: 'Team',
        monthlySalary: 130000,
        monthlySalaryByMonth: {
            '2026-01': 130000,
            '2026-02': 130000,
            '2026-03': 130000,
        },
    },
    {
        id: 'emp-yuriy-kozhevnikov',
        name: 'Юрий Кожевников',
        role: 'Product Designer',
        team: 'Strato',
        monthlySalary: 0,
        monthlySalaryByMonth: {
            '2026-01': 0,
            '2026-02': 0,
            '2026-03': 0,
        },
    },
    {
        id: 'emp-nikita-renye',
        name: 'Никита Ренье',
        role: 'Product Designer',
        team: 'Strato',
        monthlySalary: 150000,
        monthlySalaryByMonth: {
            '2026-01': 150000,
            '2026-02': 150000,
            '2026-03': 150000,
        },
    },
    {
        id: 'emp-ilya-kalyashmanov',
        name: 'Илья Каляшманов',
        role: 'Product Designer',
        team: 'Team',
        monthlySalary: 100000,
        monthlySalaryByMonth: {
            '2026-01': 100000,
            '2026-02': 100000,
            '2026-03': 100000,
        },
    },
    {
        id: 'emp-egor-nazarevskiy',
        name: 'Егор Назаревский',
        role: 'Product Designer',
        team: 'Team',
        monthlySalary: 100000,
        monthlySalaryByMonth: {
            '2026-01': 100000,
            '2026-02': 100000,
            '2026-03': 100000,
        },
    },
    {
        id: 'emp-andrey-sergeev',
        name: 'Андрей Сергеев',
        role: 'Product Designer',
        team: 'Agent',
        monthlySalary: 0,
        monthlySalaryByMonth: {
            '2026-01': 0,
            '2026-02': 0,
            '2026-03': 0,
        },
    },
    {
        id: 'emp-vyacheslav-danchenko',
        name: 'Вячеслав Данченко',
        role: 'Product Designer',
        team: 'Agent',
        monthlySalary: 0,
        monthlySalaryByMonth: {
            '2026-01': 0,
            '2026-02': 0,
            '2026-03': 0,
        },
    },
    {
        id: 'emp-erbol-tastanbekov',
        name: 'Ербол Тастанбеков',
        role: 'Product Designer',
        team: 'Team',
        monthlySalary: 64440,
        monthlySalaryByMonth: {
            '2026-01': 64680,
            '2026-02': 65170,
            '2026-03': 65940,
        },
    },
    {
        id: 'emp-ekaterina-kozhevnikova',
        name: 'Екатерина Кожевникова',
        role: 'Product Designer',
        team: 'Agent',
        monthlySalary: 0,
        monthlySalaryByMonth: {
            '2026-01': 0,
            '2026-02': 0,
            '2026-03': 0,
        },
    },
    {
        id: 'emp-larin-vyacheslav',
        name: 'Ларин Вячеслав',
        role: 'Product Designer',
        team: 'Agent',
        monthlySalary: 0,
        monthlySalaryByMonth: {
            '2026-01': 0,
            '2026-02': 0,
            '2026-03': 0,
        },
    },
    {
        id: 'emp-varzhavka-tatyana',
        name: 'Варжавка Татьяна',
        role: 'Product Designer',
        team: 'Agent',
        monthlySalary: 0,
        monthlySalaryByMonth: {
            '2026-01': 0,
            '2026-02': 0,
            '2026-03': 0,
        },
    },
    {
        id: 'emp-polina-gramm',
        name: 'Полина Грамм',
        role: 'Product Designer',
        team: 'Agent',
        monthlySalary: 0,
        monthlySalaryByMonth: {
            '2026-01': 0,
            '2026-02': 0,
            '2026-03': 0,
        },
    },
    {
        id: 'emp-anton-b',
        name: 'Антон Б.',
        role: 'Product Designer',
        team: 'Strato',
        monthlySalary: 100000,
        monthlySalaryByMonth: {
            '2026-01': 100000,
            '2026-02': 100000,
            '2026-03': 100000,
        },
    },
    {
        id: 'emp-valeriy-s',
        name: 'Валерий С.',
        role: 'Product Designer',
        team: 'Strato',
        monthlySalary: 110880,
        monthlySalaryByMonth: {
            '2026-01': 110880,
            '2026-02': 111720,
            '2026-03': 113040,
        },
    },
];

const DRY_RUN = process.argv.includes('--dry-run');
const MIGRATION_USER = 'finops-migration';
const PERFORMER_ALIASES: Record<string, string> = {
    'Антон Б.': 'Антон Бастрыкин',
    'Валерий С.': 'Валерий Сысик',
};

const upsertCategories = async (): Promise<number> => {
    const db = getDb();
    const collection = db.collection(COLLECTIONS.FINOPS_EXPENSE_CATEGORIES);
    let count = 0;
    for (const category of expenseCategories) {
        const update = {
            $set: {
                name: category.name,
                is_active: category.is_active,
                updated_at: new Date(),
                updated_by: MIGRATION_USER,
            },
            $setOnInsert: {
                category_id: category.id,
                created_at: new Date(),
                created_by: MIGRATION_USER,
            },
        };
        if (!DRY_RUN) {
            await collection.updateOne({ category_id: category.id }, update, { upsert: true });
        }
        count += 1;
    }
    return count;
};

const upsertOperations = async (): Promise<number> => {
    const db = getDb();
    const collection = db.collection(COLLECTIONS.FINOPS_EXPENSE_OPERATIONS);
    let count = 0;
    for (const operation of expenseOperationsSeed) {
        const update = {
            $set: {
                category_id: operation.category_id,
                month: operation.month,
                amount: operation.amount,
                currency: operation.currency,
                fx_used: operation.fx_used ?? null,
                vendor: operation.vendor ?? null,
                comment: operation.comment ?? null,
                attachments: operation.attachments ?? [],
                updated_at: new Date(),
                updated_by: MIGRATION_USER,
                is_deleted: false,
            },
            $setOnInsert: {
                operation_id: operation.id,
                created_at: new Date(),
                created_by: MIGRATION_USER,
            },
        };
        if (!DRY_RUN) {
            await collection.updateOne({ operation_id: operation.id }, update, { upsert: true });
        }
        count += 1;
    }
    return count;
};

const upsertFxRates = async (): Promise<number> => {
    const db = getDb();
    const collection = db.collection(COLLECTIONS.FINOPS_FX_RATES);
    let count = 0;
    for (const [month, rate] of Object.entries(fxRatesByMonth)) {
        const update = {
            $set: {
                rate,
                source: 'manual',
                created_at: new Date(),
                created_by: MIGRATION_USER,
            },
            $setOnInsert: {
                month,
                pair: 'USD/RUB',
            },
        };
        if (!DRY_RUN) {
            await collection.updateOne({ month, pair: 'USD/RUB' }, update, { upsert: true });
        }
        count += 1;
    }
    return count;
};

const updatePerformers = async (): Promise<{ updated: number; missing: string[] }> => {
    const db = getDb();
    const collection = db.collection(COLLECTIONS.PERFORMERS);
    let updated = 0;
    const missing: string[] = [];

    for (const employee of employeeDirectory) {
        const resolvedName = PERFORMER_ALIASES[employee.name] ?? employee.name;
        const filter = {
            $or: [{ name: resolvedName }, { real_name: resolvedName }],
            is_deleted: { $ne: true },
        };

        const update = {
            $set: {
                monthly_salary: employee.monthlySalary,
                salary_currency: 'RUB',
                monthly_salary_by_month: employee.monthlySalaryByMonth ?? {},
            },
        };

        if (DRY_RUN) {
            updated += 1;
            continue;
        }

        const result = await collection.updateOne(filter, update);
        if (result.matchedCount === 0) {
            missing.push(employee.name);
            continue;
        }
        updated += 1;
    }

    return { updated, missing };
};

const run = async (): Promise<void> => {
    console.log(`FinOps mocks migration ${DRY_RUN ? '(dry-run)' : ''}`);
    await connectDb();

    const categories = await upsertCategories();
    const operations = await upsertOperations();
    const fxRates = await upsertFxRates();
    const performers = await updatePerformers();

    console.log('Summary:');
    console.log(`- Categories upserted: ${categories}`);
    console.log(`- Operations upserted: ${operations}`);
    console.log(`- FX rates upserted: ${fxRates}`);
    console.log(`- Performers updated: ${performers.updated}`);
    if (performers.missing.length > 0) {
        console.log(`- Performers not found (${performers.missing.length}):`);
        performers.missing.forEach((name) => console.log(`  • ${name}`));
    }

    await closeDb();
};

run().catch(async (error) => {
    console.error('Migration failed:', error);
    await closeDb();
    process.exit(1);
});
