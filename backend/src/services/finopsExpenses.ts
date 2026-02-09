import { randomUUID } from 'crypto';
import { type Collection, type Filter, type UpdateFilter } from 'mongodb';
import { getDb } from './db.js';
import { COLLECTIONS } from '../constants.js';
import { type ExpenseCategory, type ExpenseOperation, type ExpenseOperationLog, type MonthString } from '../models/types.js';

const getCategoryCollection = (): Collection<ExpenseCategory> =>
    getDb().collection<ExpenseCategory>(COLLECTIONS.FINOPS_EXPENSE_CATEGORIES);

const getOperationCollection = (): Collection<ExpenseOperation> =>
    getDb().collection<ExpenseOperation>(COLLECTIONS.FINOPS_EXPENSE_OPERATIONS);

const getOperationLogCollection = (): Collection<ExpenseOperationLog> =>
    getDb().collection<ExpenseOperationLog>(COLLECTIONS.FINOPS_EXPENSE_OPERATIONS_LOG);

export const listExpenseCategories = async (): Promise<ExpenseCategory[]> => {
    return getCategoryCollection().find({}).sort({ name: 1 }).toArray();
};

export interface CreateExpenseCategoryParams {
    name: string;
    is_active?: boolean;
    created_by?: string | null;
}

export const createExpenseCategory = async (
    params: CreateExpenseCategoryParams,
): Promise<ExpenseCategory> => {
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
    await getCategoryCollection().insertOne(category);
    return category;
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
    const update: UpdateFilter<ExpenseCategory> = {
        $set: {
            ...(params.name !== undefined ? { name: params.name } : {}),
            ...(params.is_active !== undefined ? { is_active: params.is_active } : {}),
            updated_at: new Date(),
            updated_by: params.updated_by ?? null,
        },
    };
    await getCategoryCollection().updateOne({ category_id: params.category_id }, update);
    return getCategoryCollection().findOne({ category_id: params.category_id });
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
    const filter: Filter<ExpenseOperation> = { is_deleted: { $ne: true } };
    if (params.category_id) {
        filter.category_id = params.category_id;
    }
    if (params.month) {
        filter.month = params.month;
    } else if (params.from && params.to) {
        filter.month = { $gte: params.from, $lte: params.to };
    } else if (params.from) {
        filter.month = { $gte: params.from };
    } else if (params.to) {
        filter.month = { $lte: params.to };
    }
    return getOperationCollection().find(filter).sort({ month: 1, created_at: 1 }).toArray();
};

export const getExpenseOperation = async (operationId: string): Promise<ExpenseOperation | null> => {
    return getOperationCollection().findOne({ operation_id: operationId, is_deleted: { $ne: true } });
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
    await getOperationCollection().insertOne(operation);
    await logExpenseOperationChange({
        operation_id: operation.operation_id,
        action: 'create',
        after: operation,
        changed_by: params.created_by ?? null,
    });
    return operation;
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
    const before = await getOperationCollection().findOne({ operation_id: params.operation_id });
    if (!before) {
        return null;
    }
    const update: UpdateFilter<ExpenseOperation> = {
        $set: {
            ...(params.category_id !== undefined ? { category_id: params.category_id } : {}),
            ...(params.month !== undefined ? { month: params.month } : {}),
            ...(params.amount !== undefined ? { amount: params.amount } : {}),
            ...(params.currency !== undefined ? { currency: params.currency } : {}),
            ...(params.fx_used !== undefined ? { fx_used: params.fx_used } : {}),
            ...(params.vendor !== undefined ? { vendor: params.vendor } : {}),
            ...(params.comment !== undefined ? { comment: params.comment } : {}),
            ...(params.attachments !== undefined ? { attachments: params.attachments } : {}),
            updated_at: new Date(),
            updated_by: params.updated_by ?? null,
        },
    };
    await getOperationCollection().updateOne({ operation_id: params.operation_id }, update);
    const after = await getOperationCollection().findOne({ operation_id: params.operation_id });
    if (after) {
        await logExpenseOperationChange({
            operation_id: params.operation_id,
            action: 'update',
            before,
            after,
            changed_by: params.updated_by ?? null,
        });
    }
    return after;
};

export const deleteExpenseOperation = async (
    operationId: string,
    deletedBy?: string | null,
): Promise<ExpenseOperation | null> => {
    const before = await getOperationCollection().findOne({ operation_id: operationId });
    if (!before) {
        return null;
    }
    const update: UpdateFilter<ExpenseOperation> = {
        $set: {
            is_deleted: true,
            updated_at: new Date(),
            updated_by: deletedBy ?? null,
        },
    };
    await getOperationCollection().updateOne({ operation_id: operationId }, update);
    const after = await getOperationCollection().findOne({ operation_id: operationId });
    await logExpenseOperationChange({
        operation_id: operationId,
        action: 'delete',
        before,
        after,
        changed_by: deletedBy ?? null,
    });
    return after;
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
    const entry: ExpenseOperationLog = {
        log_id: randomUUID(),
        operation_id: params.operation_id,
        action: params.action,
        before: params.before ?? null,
        after: params.after ?? null,
        changed_by: params.changed_by ?? null,
        changed_at: new Date(),
        comment: params.comment ?? null,
    };
    await getOperationLogCollection().insertOne(entry);
    return entry;
};
