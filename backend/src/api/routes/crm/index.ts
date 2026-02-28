import { Router } from 'express';
import epicsRouter from './epics.js';
import projectsRouter from './projects.js';
import dictionaryRouter from './dictionary.js';
import ticketsRouter from './tickets.js';
import financesRouter from './finances.js';
import figmaRouter from './figma.js';
import botCommandsRouter from './legacy/botcommands.js';
import taskTypesRouter from './legacy/tasktypes.js';
import performersPaymentsRouter from './legacy/performerspayments.js';
import warehouseRouter from './warehouse.js';
import customersRouter from './customers.js';
import projectGroupsRouter from './legacy/projectgroups.js';
import projectTreeRouter from './legacy/projecttree.js';
import importRouter from './import.js';
import uploadsRouter from './uploads.js';
import voicebotRouter from './voicebot.js';
import reportsRouter from './reports.js';
import codexRouter from './codex.js';

const router = Router();

// CRM API routes
router.use('/epics', epicsRouter);
router.use('/projects', projectsRouter);
router.use('/dictionary', dictionaryRouter);
router.use('/tickets', ticketsRouter);
router.use('/finances', financesRouter);
router.use('/figma', figmaRouter);
router.use('/bot-commands', botCommandsRouter);
router.use('/taskTypes', taskTypesRouter);
router.use('/performers-payments', performersPaymentsRouter);
router.use('/warehouse', warehouseRouter);
router.use('/customers', customersRouter);
router.use('/project_groups', projectGroupsRouter);
router.use('/project_tree', projectTreeRouter);
router.use('/import', importRouter);
router.use('/upload', uploadsRouter);
router.use('/voicebot', voicebotRouter);
router.use('/reports', reportsRouter);
router.use('/codex', codexRouter);

export default router;
