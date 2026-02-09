/**
 * FinOps routes hub
 * Aggregates all financial operations routes
 */
import { Router } from 'express';
import fundRouter from '../fund.js';
import planFactRouter from '../planFact.js';
import expenseCategoriesRouter from './expensesCategories.js';
import expenseOperationsRouter from './expensesOperations.js';
import fxRatesRouter from './fxRates.js';
import monthClosuresRouter from './monthClosures.js';
import employeesRouter from './employees.js';

const router = Router();

// Fund operations (comments, etc.)
router.use('/', fundRouter);

// Plan-Fact grid operations
router.use('/', planFactRouter);

// Expenses
router.use('/', expenseCategoriesRouter);
router.use('/', expenseOperationsRouter);
router.use('/', fxRatesRouter);
router.use('/', monthClosuresRouter);
router.use('/', employeesRouter);

export default router;
