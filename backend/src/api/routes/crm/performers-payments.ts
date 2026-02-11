import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { google, type drive_v3 } from 'googleapis';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import _ from 'lodash';
import numberToWordsRu from 'number-to-words-ru';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';
import { getGoogleAuth } from '../../../services/google/sheets.js';

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(weekOfYear);
dayjs.locale('ru');

const router = Router();
const logger = getLogger();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const getRootFolderId = (): string => {
    const rootFolderId = process.env.PERFORMERS_PAYMENTS_ROOT_FOLDER_ID;
    if (!rootFolderId) {
        throw new Error('PERFORMERS_PAYMENTS_ROOT_FOLDER_ID is not configured');
    }
    return rootFolderId;
};

/**
 * Get performer finances
 * POST /api/crm/performers-payments/finances
 */
router.post('/finances', async (req: Request, res: Response) => {
    const db = getDb();
    try {
        const performer_id = req.body.performer_id as string | undefined;
        const month = Number(req.body.month);
        const year = Number(req.body.year);

        if (!performer_id || !month || !year) {
            res.status(400).json({ error: 'performer_id, month, year are required' });
            return;
        }

        const calendar_work_hours = await db
            .collection(COLLECTIONS.CALENDAR_MONTH_WORK_HOURS)
            .findOne({ month, year });

        if (!calendar_work_hours) {
            res.status(500).json({ error: 'Для расчетов нужно указать количество рабочих часов в месяце' });
            return;
        }

        const month_work_hours = calendar_work_hours.hours as number;

        const works = await db
            .collection(COLLECTIONS.WORK_HOURS)
            .find({
                date_timestamp: {
                    $gt: dayjs().year(year).month(month - 1).startOf('month').unix(),
                    $lt: dayjs().year(year).month(month - 1).endOf('month').unix(),
                },
                created_by: performer_id,
            })
            .toArray();

        const tickets = await db
            .collection(COLLECTIONS.TASKS)
            .aggregate([
                {
                    $match: { _id: { $in: works.map((w) => new ObjectId(w.ticket_db_id)) } },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'project_id',
                        foreignField: '_id',
                        as: 'project_data',
                    },
                },
            ])
            .toArray();

        type WorkEntry = {
            date?: unknown;
            work_hours?: unknown;
            comment?: unknown;
        };

        const worksGroupedByTicket = works.reduce((acc, work) => {
            const ticket = tickets.find((t) => t.id === work.ticket_id);
            if (!ticket) return acc;

            const ticketKey = ticket.id as string;
            const entry: { ticket: Record<string, unknown>; works: WorkEntry[] } = acc[ticketKey] ?? {
                ticket,
                works: [],
            };

            entry.works.push({
                date: work.date,
                work_hours: work.work_hours,
                comment: work.comment,
            });

            acc[ticketKey] = entry;

            return acc;
        }, {} as Record<string, { ticket: Record<string, unknown>; works: Array<Record<string, unknown>> }>);

        const groupedWorks = Object.values(worksGroupedByTicket) as Array<{
            ticket: Record<string, unknown> & { task_status_history?: Array<{ new_value: string; timestamp: number }> };
            works: Array<{ work_hours: number } & Record<string, unknown>>;
            totalWorkHours?: number;
            timeBetweenReadyAndDone?: number | null;
            reviewsCount?: number | null;
            timeBetweenReadyAndReview?: number | null;
        }>;

        for (const group of groupedWorks) {
            group.totalWorkHours = group.works.reduce((sum, work) => sum + Number(work.work_hours ?? 0), 0);
            const history = group.ticket.task_status_history ?? [];
            const readyStatus = history.find(
                (status) => status.new_value === 'Progress 10' || status.new_value === 'Ready'
            );
            const doneStatus = history.find(
                (status) =>
                    status.new_value === 'Done' ||
                    status.new_value === 'Complete' ||
                    status.new_value === 'PostWork' ||
                    status.new_value === 'Archive'
            );

            const timeBetweenReadyAndDone =
                readyStatus && doneStatus
                    ? (doneStatus.timestamp - readyStatus.timestamp) / (1000 * 60 * 60 * 24)
                    : null;

            group.timeBetweenReadyAndDone = timeBetweenReadyAndDone;

            const reviewsCount = history.filter((status) => status.new_value === 'Review / Ready').length;
            group.reviewsCount = timeBetweenReadyAndDone != null && reviewsCount > 0 ? reviewsCount : null;

            const reviewStatus = history.find((status) => status.new_value === 'Review / Ready');
            const timeBetweenReadyAndReview =
                readyStatus && reviewStatus
                    ? (reviewStatus.timestamp - readyStatus.timestamp) / (1000 * 60 * 60 * 24)
                    : null;

            group.timeBetweenReadyAndReview = timeBetweenReadyAndReview;
        }

        const daysInMonth = dayjs().year(year).month(month - 1).daysInMonth();
        const dailyWorkHours = Array.from({ length: daysInMonth }, () => 0);

        const dailyWorkHoursByDate: Record<string, number> = {};
        for (const work of works) {
            const dayOfMonth = dayjs.unix(work.date_timestamp).date() - 1;
            if (dayOfMonth >= 0 && dayOfMonth < dailyWorkHours.length) {
                dailyWorkHours[dayOfMonth] =
                    (dailyWorkHours[dayOfMonth] ?? 0) + Number(work.work_hours ?? 0);
            }
            const date = dayjs.unix(work.date_timestamp).format('YYYY-MM-DD');
            dailyWorkHoursByDate[date] = (dailyWorkHoursByDate[date] ?? 0) + Number(work.work_hours ?? 0);
        }

        const totalWorkHoursByDay = dailyWorkHours.filter((dayData) => dayData !== 0);
        const totalWorkHours = totalWorkHoursByDay.reduce((total, dayData) => total + dayData, 0);
        const averageWorkHours = totalWorkHoursByDay.length
            ? totalWorkHours / totalWorkHoursByDay.length
            : 0;

        const groupedWorksWithReviews = groupedWorks.filter((group) => group.reviewsCount != null).length;
        const averageReviewsCount = groupedWorksWithReviews
            ? groupedWorks.reduce((total, group) => total + Number(group.reviewsCount ?? 0), 0) / groupedWorksWithReviews
            : 0;
        const groupedWorksWithTime = groupedWorks.filter((group) => group.timeBetweenReadyAndDone != null).length;
        const averageTimeBetweenReadyAndDone = groupedWorksWithTime
            ? groupedWorks.reduce((total, group) => total + Number(group.timeBetweenReadyAndDone ?? 0), 0) / groupedWorksWithTime
            : 0;
        const groupedWorksWithReview = groupedWorks.filter((group) => group.timeBetweenReadyAndReview != null).length;
        const averageTimeBetweenReadyAndReview = groupedWorksWithReview
            ? groupedWorks.reduce((total, group) => total + Number(group.timeBetweenReadyAndReview ?? 0), 0) /
            groupedWorksWithReview
            : 0;

        const NORMAL_WORK_HOURS = 6;
        const daysAboveNormal = dailyWorkHours.filter((dayData) => dayData > NORMAL_WORK_HOURS).length;
        const daysBelowANormal = dailyWorkHours.filter((dayData) => dayData < NORMAL_WORK_HOURS && dayData !== 0).length;

        const totalDaysWithWork = dailyWorkHours.filter((dayData) => dayData !== 0).length;

        const NORMAL_TIME_BETWEEN_READY_AND_REVIEW = 4;
        const ticketsAboveNormalTimeBetweenReadyAndReview = groupedWorks.filter(
            (group) =>
                group.timeBetweenReadyAndReview != null &&
                group.timeBetweenReadyAndReview > NORMAL_TIME_BETWEEN_READY_AND_REVIEW
        ).length;
        const ticketsBelowNormalTimeBetweenReadyAndReview = groupedWorks.filter(
            (group) =>
                group.timeBetweenReadyAndReview != null &&
                group.timeBetweenReadyAndReview <= NORMAL_TIME_BETWEEN_READY_AND_REVIEW
        ).length;

        const works_statistic = {
            month_work_hours,
            totalDaysWithWork,
            totalWorkHours,
            averageWorkHours,
            daysAboveNormal,
            daysBelowANormal,
            averageReviewsCount: averageReviewsCount.toFixed(2),
            averageTimeBetweenReadyAndDone: averageTimeBetweenReadyAndDone.toFixed(2),
            averageTimeBetweenReadyAndReview: averageTimeBetweenReadyAndReview.toFixed(2),
            closedTasks: groupedWorksWithTime,
            ticketWithReviewCount: groupedWorksWithReview,
            ticketsAboveNormalTimeBetweenReadyAndReview,
            ticketsBelowNormalTimeBetweenReadyAndReview,
        };

        const ticketsGroupedByProjects = _.reduce(
            groupedWorks,
            (result, obj) => {
                const project = String((obj.ticket as { project?: string }).project ?? '');
                if (!result[project]) result[project] = [];
                result[project].push(obj);
                return result;
            },
            {} as Record<string, typeof groupedWorks>
        );

        res.status(200).json({
            performer_id,
            month,
            year,
            works_statistic,
            tickets: ticketsGroupedByProjects,
            dailyWorkHoursByDate,
        });
    } catch (error) {
        logger.error('Error getting performer finances:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Create payment
 * POST /api/crm/performers-payments/create-payment
 */
router.post('/create-payment', async (req: Request, res: Response) => {
    const db = getDb();
    try {
        const { performer_id, works, total, paymentData, month, year } = req.body as {
            performer_id?: string;
            works?: Record<string, string[]>;
            total?: number;
            paymentData?: Record<string, unknown> & { payment_name?: string; payment_date?: string };
            month?: number;
            year?: number;
        };

        if (!performer_id || !paymentData || !month || !year) {
            res.status(400).json({ error: 'performer_id, paymentData, month, year are required' });
            return;
        }

        dayjs.locale('ru');

        const act_number = month + 1;
        const act_date = dayjs(paymentData.payment_date).format('DD MMMM YYYY г.');

        const works_list: string[] = [];
        const total_summ = Number(total ?? 0);
        const total_summ_words = numberToWordsRu.convert(total_summ);

        Object.entries(works ?? {}).forEach(([project, projectWorks]) => {
            if (!projectWorks || projectWorks.length === 0) return;
            projectWorks.forEach((w) => works_list.push(`${project} - ${w}`));
        });

        const works_list_text = works_list.join('\n');

        const auth = getGoogleAuth();
        const docs = google.docs({ version: 'v1', auth });
        const drive = google.drive({ version: 'v3', auth });

        const root_folder_id = getRootFolderId();

        const performer = await db.collection(COLLECTIONS.PERFORMERS).findOne({ id: performer_id });
        if (!performer) {
            res.status(404).json({ error: 'Исполнитель не найден' });
            return;
        }

        const performer_folder_name = performer.google_drive_name as string;
        let parentFolderId: string | null = null;

        const performer_folder = await drive.files.list({
            q: `name='${performer_folder_name}' and mimeType='application/vnd.google-apps.folder' and '${root_folder_id}' in parents`,
            fields: 'files(id, name)',
        });

        await sleep(1000);

        let performerFolderId: string | null = null;
        if (performer_folder.data.files && performer_folder.data.files.length > 0) {
            performerFolderId = performer_folder.data.files[0]?.id ?? null;
        } else {
            const newFolder = await drive.files.create({
                requestBody: {
                    name: performer_folder_name,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [root_folder_id],
                },
                fields: 'id',
            });
            await sleep(1000);
            performerFolderId = newFolder.data.id ?? null;
        }

        if (!performerFolderId) {
            res.status(500).json({ error: 'Не удалось определить папку исполнителя' });
            return;
        }

        parentFolderId = performerFolderId;

        const templates_folder_name = 'templates';
        const templates_folder = await drive.files.list({
            q: `name='${templates_folder_name}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents`,
            fields: 'files(id, name)',
        });
        await sleep(1000);

        if (templates_folder.data.files && templates_folder.data.files.length > 0) {
            parentFolderId = templates_folder.data.files[0]?.id ?? null;
        } else {
            const newTemplatesFolder = await drive.files.create({
                requestBody: {
                    name: templates_folder_name,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [parentFolderId],
                },
                fields: 'id',
            });
            await sleep(1000);
            parentFolderId = newTemplatesFolder.data.id ?? null;
        }

        if (!parentFolderId) {
            res.status(500).json({ error: 'Не удалось определить папку templates' });
            return;
        }

        const template_file_name = 'act_template.docx';
        const template_file = await drive.files.list({
            q: `name='${template_file_name}' and '${parentFolderId}' in parents`,
            fields: 'files(id, name)',
        });
        await sleep(1000);

        const template_google_doc_id = template_file.data.files?.[0]?.id;
        if (!template_google_doc_id) {
            res.status(404).json({ error: 'Шаблон документа не найден' });
            return;
        }

        const payments_folder_name = 'payments';
        const payments_folder = await drive.files.list({
            q: `name='${payments_folder_name}' and mimeType='application/vnd.google-apps.folder' and '${performerFolderId}' in parents`,
            fields: 'files(id, name)',
        });
        await sleep(1000);

        if (payments_folder.data.files && payments_folder.data.files.length > 0) {
            parentFolderId = payments_folder.data.files[0]?.id ?? null;
        } else {
            const newPaymentsFolder = await drive.files.create({
                requestBody: {
                    name: payments_folder_name,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [performerFolderId],
                },
                fields: 'id',
            });
            await sleep(1000);
            parentFolderId = newPaymentsFolder.data.id ?? null;
        }

        if (!parentFolderId) {
            res.status(500).json({ error: 'Не удалось определить папку payments' });
            return;
        }

        const year_folder_name = String(year);
        const year_folder = await drive.files.list({
            q: `name='${year_folder_name}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents`,
            fields: 'files(id, name)',
        });
        await sleep(1000);

        if (year_folder.data.files && year_folder.data.files.length > 0) {
            parentFolderId = year_folder.data.files[0]?.id ?? null;
        } else {
            const newYearFolder = await drive.files.create({
                requestBody: {
                    name: year_folder_name,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [parentFolderId],
                },
                fields: 'id',
            });
            await sleep(1000);
            parentFolderId = newYearFolder.data.id ?? null;
        }

        if (!parentFolderId) {
            res.status(500).json({ error: 'Не удалось определить папку года' });
            return;
        }

        const payment_folder_name = String(paymentData.payment_name ?? 'payment');
        const payment_folder = await drive.files.list({
            q: `name='${payment_folder_name}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents`,
            fields: 'files(id, name)',
        });
        await sleep(1000);

        if (payment_folder.data.files && payment_folder.data.files.length > 0) {
            parentFolderId = payment_folder.data.files[0]?.id ?? null;
        } else {
            const newPaymentFolder = await drive.files.create({
                requestBody: {
                    name: payment_folder_name,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [parentFolderId],
                },
                fields: 'id',
            });
            await sleep(1000);
            parentFolderId = newPaymentFolder.data.id ?? null;
        }

        if (!parentFolderId) {
            res.status(500).json({ error: 'Не удалось определить папку платежа' });
            return;
        }

        const copyRequest: drive_v3.Schema$File = {
            name: `Акт выполненных работ - ${act_number}`,
            mimeType: 'application/vnd.google-apps.document',
        };
        if (parentFolderId) {
            copyRequest.parents = [parentFolderId];
        }

        const new_doc = await drive.files.copy({
            fileId: template_google_doc_id,
            requestBody: copyRequest,
        });
        await sleep(1000);

        const new_doc_id = new_doc.data?.id;
        if (!new_doc_id) {
            res.status(500).json({ error: 'Не удалось создать документ' });
            return;
        }

        await docs.documents.batchUpdate({
            documentId: new_doc_id,
            requestBody: {
                requests: [
                    {
                        replaceAllText: {
                            containsText: { text: '{{act_number}}', matchCase: true },
                            replaceText: String(act_number),
                        },
                    },
                    {
                        replaceAllText: {
                            containsText: { text: '{{act_date}}', matchCase: true },
                            replaceText: act_date,
                        },
                    },
                    {
                        replaceAllText: {
                            containsText: { text: '{{works_list}}', matchCase: true },
                            replaceText: works_list_text,
                        },
                    },
                    {
                        replaceAllText: {
                            containsText: { text: '{{total_summ}}', matchCase: true },
                            replaceText: total_summ.toFixed(2).toString(),
                        },
                    },
                    {
                        replaceAllText: {
                            containsText: { text: '{{total_summ_words}}', matchCase: true },
                            replaceText: total_summ_words,
                        },
                    },
                ],
            },
        });
        await sleep(1000);

        const newDocLink = `https://docs.google.com/document/d/${new_doc_id}/edit`;

        const paymentDataToSave = {
            performer_id,
            works,
            total,
            paymentData: {
                ...paymentData,
                payment_date: dayjs(paymentData.payment_date).format('YYYY-MM-DD'),
                document_link: newDocLink,
                document_id: new_doc_id,
            },
        };

        await db.collection(COLLECTIONS.PERFORMER_PAYMENTS).insertOne(paymentDataToSave);

        res.status(200).json({
            documentId: new_doc_id,
            documentLink: newDocLink,
            payment_folder_name,
            documentName: `Акт выполненных работ - ${act_number}`,
        });
    } catch (error) {
        logger.error('Error creating payment:', error);
        res.status(500).json({ error: String(error) });
    } finally {
        dayjs.locale('en');
    }
});

/**
 * Get payments tree
 * POST /api/crm/performers-payments/payments-tree
 */
router.post('/payments-tree', async (_req: Request, res: Response) => {
    const db = getDb();
    try {
        const rootFolderId = getRootFolderId();
        const auth = getGoogleAuth();
        const drive = google.drive({ version: 'v3', auth });

        const listResponse = await drive.files.list({
            q: `'${rootFolderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType, parents)',
        });
        const rootFolderContents = listResponse.data.files ?? [];
        const rootFolders = rootFolderContents.filter(
            (item) => item.mimeType === 'application/vnd.google-apps.folder'
        );

        const performers = await db
            .collection(COLLECTIONS.PERFORMERS)
            .find({ is_employee: true })
            .toArray();

        const performersFolders = performers.map((performer) => performer.google_drive_name).filter(Boolean);
        const foldersToCreate = _.difference(performersFolders, rootFolders.map((folder) => folder.name));

        for (const folderName of foldersToCreate) {
            await drive.files.create({
                requestBody: {
                    name: folderName,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [rootFolderId],
                },
                fields: 'id',
            });
            await sleep(2000);
        }

        const updatedRootFolderContents = await drive.files.list({
            q: `'${rootFolderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType, parents)',
        });
        const updatedRootFolders = (updatedRootFolderContents.data.files ?? []).filter(
            (item) => item.mimeType === 'application/vnd.google-apps.folder'
        );
        rootFolders.push(
            ...updatedRootFolders.filter(
                (folder) => !rootFolders.some((existingFolder) => existingFolder.name === folder.name)
            )
        );

        const payments_tree: Record<string, unknown> = {};

        for (const rootFolder of rootFolders) {
            const performer = performers.find((p) => p.google_drive_name === rootFolder.name);
            if (!performer) {
                continue;
            }

            const performerFolderId = rootFolder.id;
            if (!performerFolderId) continue;

            const performerFolderContents = await drive.files.list({
                q: `'${performerFolderId}' in parents and trashed = false`,
                fields: 'files(id, name, mimeType, parents)',
            });

            const templatesFolder = performerFolderContents.data.files?.find(
                (file) => file.name === 'templates' && file.mimeType === 'application/vnd.google-apps.folder'
            );
            const paymentsFolder = performerFolderContents.data.files?.find(
                (file) => file.name === 'payments' && file.mimeType === 'application/vnd.google-apps.folder'
            );

            if (!templatesFolder) {
                await drive.files.create({
                    requestBody: {
                        name: 'templates',
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [performerFolderId],
                    },
                    fields: 'id',
                });
                await sleep(2000);
            }

            if (!paymentsFolder) {
                await drive.files.create({
                    requestBody: {
                        name: 'payments',
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [performerFolderId],
                    },
                    fields: 'id',
                });
                await sleep(2000);
            }

            const refreshedPerformerFolderContents = await drive.files.list({
                q: `'${performerFolderId}' in parents and trashed = false`,
                fields: 'files(id, name, mimeType, parents)',
            });
            const templatesFolderRef = refreshedPerformerFolderContents.data.files?.find(
                (file) => file.name === 'templates' && file.mimeType === 'application/vnd.google-apps.folder'
            );
            const paymentsFolderRef = refreshedPerformerFolderContents.data.files?.find(
                (file) => file.name === 'payments' && file.mimeType === 'application/vnd.google-apps.folder'
            );

            if (!templatesFolderRef || !paymentsFolderRef) {
                continue;
            }

            const templatesList = await drive.files.list({
                q: `'${templatesFolderRef.id}' in parents and trashed = false`,
                fields: 'files(id, name, webViewLink)',
            });

            const paymentsList = await drive.files.list({
                q: `'${paymentsFolderRef.id}' in parents and trashed = false`,
                fields: 'files(id, name, mimeType, parents, createdTime)',
            });
            const paymentsYearsFolders = (paymentsList.data.files ?? []).filter(
                (item) => item.mimeType === 'application/vnd.google-apps.folder'
            );

            const currentYear = new Date().getFullYear().toString();
            if (!paymentsYearsFolders.some((folder) => folder.name === currentYear)) {
                await drive.files.create({
                    requestBody: {
                        name: currentYear,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [paymentsFolderRef.id ?? ''],
                    },
                    fields: 'id',
                });
                await sleep(2000);
            }

            const updatedPaymentsList = await drive.files.list({
                q: `'${paymentsFolderRef.id}' in parents and trashed = false`,
                fields: 'files(id, name, mimeType, parents, createdTime)',
            });

            const paymentsYears = (updatedPaymentsList.data.files ?? []).filter(
                (item) => item.mimeType === 'application/vnd.google-apps.folder'
            );

            const paymentsData: Record<string, Record<string, unknown[]>> = {};
            for (const yearFolder of paymentsYears) {
                if (!yearFolder.id || !yearFolder.name) continue;
                const yearPaymentsList = await drive.files.list({
                    q: `'${yearFolder.id}' in parents and trashed = false`,
                    fields: 'files(id, name, mimeType, webViewLink, createdTime)',
                });

                const paymentsMonthsFolders = (yearPaymentsList.data.files ?? []).filter(
                    (item) => item.mimeType === 'application/vnd.google-apps.folder'
                );

                const monthsData: Record<string, unknown[]> = {};
                for (const monthFolder of paymentsMonthsFolders) {
                    if (!monthFolder.id || !monthFolder.name) continue;
                    const monthFilesList = await drive.files.list({
                        q: `'${monthFolder.id}' in parents and trashed = false`,
                        fields: 'files(id, name, mimeType, webViewLink, createdTime)',
                    });
                    monthsData[monthFolder.name] = (monthFilesList.data.files ?? []).map((file) => ({
                        id: file.id,
                        name: file.name,
                        mimeType: file.mimeType,
                        webViewLink: file.webViewLink,
                        createdTime: file.createdTime,
                    }));
                }

                paymentsData[yearFolder.name] = monthsData;
            }

            payments_tree[String(performer._id)] = {
                performer: {
                    id: performer._id,
                    name: performer.name,
                    google_drive_name: performer.google_drive_name,
                    real_name: performer.real_name,
                    corporate_email: performer.corporate_email,
                    telegram_id: performer.telegram_id,
                    telegram_name: performer.telegram_name,
                },
                templates: (templatesList.data.files ?? []).map((file) => ({
                    id: file.id,
                    name: file.name,
                    webViewLink: file.webViewLink,
                })),
                payments: paymentsData,
            };
        }

        res.status(200).json({ payments_tree });
    } catch (error) {
        logger.error('Error getting payments tree:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get payments settings
 * POST /api/crm/performers-payments/payments-settings
 */
router.post('/payments-settings', async (_req: Request, res: Response) => {
    const db = getDb();
    try {
        const performers = await db
            .collection(COLLECTIONS.PERFORMERS)
            .find({ is_deleted: { $ne: true } })
            .toArray();

        res.status(200).json(performers);
    } catch (error) {
        logger.error('Error getting payments settings:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Save payments settings
 * POST /api/crm/performers-payments/save-payments-settings
 */
router.post('/save-payments-settings', async (req: Request, res: Response) => {
    const db = getDb();
    try {
        const performer_id = req.body.performer_id as string | undefined;
        const payments_settings = req.body.payments_settings as Record<string, unknown> | undefined;

        if (!performer_id || !payments_settings) {
            res.status(400).json({ error: 'performer_id and payments_settings are required' });
            return;
        }

        const op_res = await db
            .collection(COLLECTIONS.PERFORMERS)
            .updateOne({ _id: new ObjectId(performer_id) }, { $set: { payments_settings } });

        if (op_res.modifiedCount === 0) {
            res.status(500).json({ error: 'Пользователь не найден или настройки не изменены' });
            return;
        }

        res.status(200).json({ result: 'success', message: 'Настройки платежей сохранены' });
    } catch (error) {
        logger.error('Error saving payments settings:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
