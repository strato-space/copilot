import { randomUUID } from 'crypto';
import { type Collection, type Filter, type UpdateFilter } from 'mongodb';
import { getDb } from './db.js';
import { COLLECTIONS } from '../constants.js';
import { type ExpenseCategory, type ExpenseOperation, type ExpenseOperationLog, type MonthString } from '../models/types.js';

interface ExpenseCollections {
    categories: Collection<ExpenseCategory>;
    operations: Collection<ExpenseOperation>;
    operationLogs: Collection<ExpenseOperationLog>;
}

const getExpenseCollections = (): ExpenseCollections => {
    const db = getDb();
    return {
        categories: db.collection<ExpenseCategory>(COLLECTIONS.FINOPS_EXPENSE_CATEGORIES),
        operations: db.collection<ExpenseOperation>(COLLECTIONS.FINOPS_EXPENSE_OPERATIONS),
        operationLogs: db.collection<ExpenseOperationLog>(COLLECTIONS.FINOPS_EXPENSE_OPERATIONS_LOG),
    };
};

const withExpenseCollections = async <T>(
    handler: (collections: ExpenseCollections) => Promise<T>,
): Promise<T> => {
    return await handler(getExpenseCollections());
};

const buildMonthFilter = (params: ListExpenseOperationsParams): Filter<ExpenseOperation>['month'] | undefined => {
    if (params.month) {
        return params.month;
    }
    if (params.from && params.to) {
        return { $gte: params.from, $lte: params.to };
    }
    if (params.from) {
        return { $gte: params.from };
    }
    if (params.to) {
        return { $lte: params.to };
    }
    return undefined;
};

const buildCategoryUpdate = (params: UpdateExpenseCategoryParams): UpdateFilter<ExpenseCategory> => ({
    $set: {
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.is_active !== undefined ? { is_active: params.is_active } : {}),
        updated_at: new Date(),
        updated_by: params.updated_by ?? null,
    },
});

const buildOperationUpdate = (
    params: UpdateExpenseOperationParams,
    updatedBy: string | null | undefined,
    options: { isDeleted?: boolean } = {},
): UpdateFilter<ExpenseOperation> => ({
    $set: {
        ...(params.category_id !== undefined ? { category_id: params.category_id } : {}),
        ...(params.month !== undefined ? { month: params.month } : {}),
        ...(params.amount !== undefined ? { amount: params.amount } : {}),
        ...(params.currency !== undefined ? { currency: params.currency } : {}),
        ...(params.fx_used !== undefined ? { fx_used: params.fx_used } : {}),
        ...(params.vendor !== undefined ? { vendor: params.vendor } : {}),
        ...(params.comment !== undefined ? { comment: params.comment } : {}),
        ...(params.attachments !== undefined ? { attachments: params.attachments } : {}),
        ...(options.isDeleted !== undefined ? { is_deleted: options.isDeleted } : {}),
        updated_at: new Date(),
        updated_by: updatedBy ?? null,
    },
});

const fetchOperationById = async (
    collections: ExpenseCollections,
    operationId: string,
): Promise<ExpenseOperation | null> => {
    return collections.operations.findOne({ operation_id: operationId });
};

const buildOperationLogEntry = (params: LogExpenseOperationParams): ExpenseOperationLog => ({
    log_id: randomUUID(),
    operation_id: params.operation_id,
    action: params.action,
    before: params.before ?? null,
    after: params.after ?? null,
    changed_by: params.changed_by ?? null,
    changed_at: new Date(),
    comment: params.comment ?? null,
});

const insertOperationLogEntry = async (
    collections: ExpenseCollections,
    params: LogExpenseOperationParams,
): Promise<ExpenseOperationLog> => {
    const entry = buildOperationLogEntry(params);
    await collections.operationLogs.insertOne(entry);
    return entry;
};

export const listExpenseCategories = async (): Promise<ExpenseCategory[]> => {
    return withExpenseCollections(async ({ categories }) => (
        categories.find({}).sort({ name: 1 }).toArray()
    ));
};

export interface CreateExpenseCategoryParams {
    name: string;
    is_active?: boolean;
    created_by?: string | null;
}

export const createExpenseCategory = async (
    params: CreateExpenseCategoryParams,
): Promise<ExpenseCategory> => {
    return withExpenseCollections(async ({ categories }) => {
        const now = new Date();
        const category: ExpenseCategory = {
            category_id: randomUUID(),
            name: params.name,
            is_active: params.is_active ?? true,
            created_at: now,
            updated_at: now,
            created_by: params.created_by ?? null,
            updated_by: params.created_by ?? null,
        };
        await categories.insertOne(category);
        return category;
    });
};

export interface UpdateExpenseCategoryParams {
    category_id: string;
    name?: string;
    is_active?: boolean;
    updated_by?: string | null;
}

export const updateExpenseCategory = async (
    params: UpdateExpenseCategoryParams,
): Promise<ExpenseCategory | null> => {
    return withExpenseCollections(async ({ categories }) => {
        const update = buildCategoryUpdate(params);
        await categories.updateOne({ category_id: params.category_id }, update);
        return categories.findOne({ category_id: params.category_id });
    });
};

export interface ListExpenseOperationsParams {
    from?: MonthString;
    to?: MonthString;
    month?: MonthString;
    category_id?: string;
}

export const listExpenseOperations = async (
    params: ListExpenseOperationsParams,
): Promise<ExpenseOperation[]> => {
    return withExpenseCollections(async ({ operations }) => {
        const filter: Filter<ExpenseOperation> = { is_deleted: { $ne: true } };
        if (params.category_id) {
            filter.category_id = params.category_id;
        }
        const monthFilter = buildMonthFilter(params);
        if (monthFilter !== undefined) {
            filter.month = monthFilter;
        }
        return operations.find(filter).sort({ month: 1, created_at: 1 }).toArray();
    });
};

export const getExpenseOperation = async (operationId: string): Promise<ExpenseOperation | null> => {
    return withExpenseCollections(async ({ operations }) => (
        operations.findOne({ operation_id: operationId, is_deleted: { $ne: true } })
    ));
};

export interface CreateExpenseOperationParams {
    category_id: string;
    month: MonthString;
    amount: number;
    currency: ExpenseOperation['currency'];
    fx_used?: number | null;
    vendor?: string | null;
    comment?: string | null;
    attachments?: string[];
    created_by?: string | null;
}

export const createExpenseOperation = async (
    params: CreateExpenseOperationParams,
): Promise<ExpenseOperation> => {
    return withExpenseCollections(async (collections) => {
        const now = new Date();
        const operation: ExpenseOperation = {
            operation_id: randomUUID(),
            category_id: params.category_id,
            month: params.month,
            amount: params.amount,
            currency: params.currency,
            fx_used: params.fx_used ?? null,
            vendor: params.vendor ?? null,
            comment: params.comment ?? null,
            attachments: params.attachments ?? [],
            created_at: now,
            updated_at: now,
            created_by: params.created_by ?? null,
            updated_by: params.created_by ?? null,
            is_deleted: false,
        };
        await collections.operations.insertOne(operation);
        await insertOperationLogEntry(collections, {
            operation_id: operation.operation_id,
            action: 'create',
            after: operation,
            changed_by: params.created_by ?? null,
        });
        return operation;
    });
};

export interface UpdateExpenseOperationParams {
    operation_id: string;
    category_id?: string;
    month?: MonthString;
    amount?: number;
    currency?: ExpenseOperation['currency'];
    fx_used?: number | null;
    vendor?: string | null;
    comment?: string | null;
    attachments?: string[];
    updated_by?: string | null;
}

export const updateExpenseOperation = async (
    params: UpdateExpenseOperationParams,
): Promise<ExpenseOperation | null> => {
    return withExpenseCollections(async (collections) => {
        const before = await fetchOperationById(collections, params.operation_id);
        if (!before) {
            return null;
        }
        const update = buildOperationUpdate(params, params.updated_by);
        await collections.operations.updateOne({ operation_id: params.operation_id }, update);
        const after = await fetchOperationById(collections, params.operation_id);
        if (after) {
            await insertOperationLogEntry(collections, {
                operation_id: params.operation_id,
                action: 'update',
                before,
                after,
                changed_by: params.updated_by ?? null,
            });
        }
        return after;
    });
};

export const deleteExpenseOperation = async (
    operationId: string,
    deletedBy?: string | null,
): Promise<ExpenseOperation | null> => {
    return withExpenseCollections(async (collections) => {
        const before = await fetchOperationById(collections, operationId);
        if (!before) {
            return null;
        }
        const update = buildOperationUpdate({ operation_id: operationId }, deletedBy, { isDeleted: true });
        await collections.operations.updateOne({ operation_id: operationId }, update);
        const after = await fetchOperationById(collections, operationId);
        await insertOperationLogEntry(collections, {
            operation_id: operationId,
            action: 'delete',
            before,
            after,
            changed_by: deletedBy ?? null,
        });
        return after;
    });
};

interface LogExpenseOperationParams {
    operation_id: string;
    action: ExpenseOperationLog['action'];
    before?: ExpenseOperation | null;
    after?: ExpenseOperation | null;
    changed_by?: string | null;
    comment?: string | null;
}

export const logExpenseOperationChange = async (
    params: LogExpenseOperationParams,
): Promise<ExpenseOperationLog> => {
    return withExpenseCollections(async (collections) => (
        insertOperationLogEntry(collections, params)
    ));
};
