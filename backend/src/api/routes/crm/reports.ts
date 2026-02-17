import { Router, type Request, type Response } from 'express';
import { sendOk, sendError } from '../../middleware/response.js';
import { authMiddleware, type AuthenticatedRequest } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/roleGuard.js';
import { COLLECTIONS } from '../../../constants.js';
import { generateJiraStyleReport } from '../../../services/reports/jiraStyleReport.js';
import { generatePerformerWeeksReport } from '../../../services/reports/performerWeeksReport.js';
import type { JiraStyleReportParams, PerformerWeeksReportParams } from '../../../services/reports/types.js';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

router.use(authMiddleware);
router.use(requireAdmin);

const logReport = async (req: AuthenticatedRequest, payload: Record<string, unknown>): Promise<void> => {
    try {
        await req.db.collection(COLLECTIONS.REPORTS_LOG).insertOne(payload);
    } catch (error) {
        logger.error('Failed to write report log', { error });
    }
};

router.post('/jira-style', async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { customerId, startDate, endDate } = req.body as JiraStyleReportParams;

    if (!customerId || !startDate || !endDate) {
        sendError(res, { message: 'Missing required parameters' }, 400);
        return;
    }

    const logBase = {
        reportType: 'jira_style',
        params: { customerId, startDate, endDate },
        createdAt: new Date(),
        createdBy: {
            userId: authReq.user?.userId,
            email: authReq.user?.email,
            name: authReq.user?.name,
            role: authReq.user?.role,
        },
    };

    try {
        const result = await generateJiraStyleReport({ customerId, startDate, endDate }, authReq.db, logger);
        await logReport(authReq, {
            ...logBase,
            status: 'success',
            documentId: result.documentId,
            sheetId: result.sheetId,
            url: result.url,
        });
        sendOk(res, result);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await logReport(authReq, {
            ...logBase,
            status: 'error',
            errorMessage: message,
        });
        sendError(res, {
            message: 'Не удалось сформировать отчет. Проверьте параметры и доступы.',
            details: message,
        }, 500);
    }
});

router.post('/performer-weeks', async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { performerId, startDate, endDate } = req.body as PerformerWeeksReportParams;

    if (!performerId || !startDate || !endDate) {
        sendError(res, { message: 'Missing required parameters' }, 400);
        return;
    }

    const logBase = {
        reportType: 'performer_weeks',
        params: { performerId, startDate, endDate },
        createdAt: new Date(),
        createdBy: {
            userId: authReq.user?.userId,
            email: authReq.user?.email,
            name: authReq.user?.name,
            role: authReq.user?.role,
        },
    };

    try {
        const result = await generatePerformerWeeksReport({ performerId, startDate, endDate }, authReq.db, logger);
        await logReport(authReq, {
            ...logBase,
            status: 'success',
            documentId: result.documentId,
            sheetId: result.sheetId,
            url: result.url,
        });
        sendOk(res, result);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await logReport(authReq, {
            ...logBase,
            status: 'error',
            errorMessage: message,
        });
        sendError(res, {
            message: 'Не удалось сформировать отчет. Проверьте параметры и доступы.',
            details: message,
        }, 500);
    }
});

export default router;
