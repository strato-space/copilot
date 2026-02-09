import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import crypto from 'crypto';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import _ from 'lodash';
import jwt from 'jsonwebtoken';
import { ObjectId, type Db, type UpdateFilter } from 'mongodb';
import type { Queue } from 'bullmq';
import type { Logger } from 'winston';

import { COLLECTIONS, NOTIFICATIONS, TASK_CLASSES, TASK_STATUSES } from '../../constants.js';

dayjs.extend(customParseFormat);

interface TelegramUserData {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    allows_write_to_pm?: boolean;
    photo_url?: string;
}

export interface MiniappDeps {
    db: Db;
    notificationQueue: Queue;
    logger: Logger;
    testData: Record<string, unknown>;
}

type MiniappRequest = Request & { user?: Record<string, unknown> };

export const createMiniappRouter = ({ db, notificationQueue, logger, testData }: MiniappDeps): Router => {
    const router = express.Router();

    router.get('/login', async (req: Request, res: Response) => {
        try {
            let data = req.query as Record<string, string> | Record<string, unknown>;
            const urlParams = new URLSearchParams(data as Record<string, string>);

            logger.info('Try login', { ip: req.ip, query: Object.fromEntries(urlParams) });

            const isDebug = process.env.IS_MINIAPP_DEBUG_MODE === 'true';

            const hash = urlParams.get('hash');
            if (!hash && !isDebug) {
                res.status(401).json({ error: 'Access denied!' });
                return;
            }

            urlParams.delete('hash');
            urlParams.sort();

            let dataCheckString = '';
            for (const [key, value] of urlParams.entries()) {
                dataCheckString += `${key}=${value}\n`;
            }
            dataCheckString = dataCheckString.slice(0, -1);

            const token = process.env.TG_MINIAPP_BOT_TOKEN ?? '';
            const secret = crypto.createHmac('sha256', 'WebAppData').update(token);
            const calculatedHash = crypto.createHmac('sha256', secret.digest()).update(dataCheckString).digest('hex');
            const isVerified = calculatedHash === hash;

            if (isVerified || isDebug) {
                if (isDebug) {
                    logger.info('Using test user tg data');
                    data = testData as Record<string, string>;
                }

                const user = JSON.parse((data as { user: string }).user) as TelegramUserData;
                const dbUser = await db
                    .collection(COLLECTIONS.PERFORMERS)
                    .findOne({ telegram_id: user.id.toString() });

                if (!dbUser) {
                    logger.error('User not found', { user });
                    res.status(401).json({ error: 'Access denied!' });
                    return;
                }

                const dbData = _.pick(dbUser, ['name', 'real_name', 'birth_date', '_id', 'timezone', 'position', 'telegram_id', 'id']);
                const tgData = _.pick(user, ['language_code', 'photo_url']);

                const userData = { ...dbData, ...tgData };
                logger.info('User logged in', { user: userData });

                const jwtSecret = process.env.APP_ENCRYPTION_KEY ?? '';
                const jwtToken = jwt.sign(userData, jwtSecret, { expiresIn: '30d' });

                res
                    .cookie('token', jwtToken, { path: '/', httpOnly: true, maxAge: 1000 * 60 * 60 })
                    .status(200)
                    .json(userData);
            } else {
                logger.error('Bad init tg data', { data });
                res.status(401).json({ error: 'Access denied!' });
            }
        } catch (error) {
            logger.error('Login error', { error });
            res.status(500).json({ error: `${error}` });
        }
    });

    const requireAuth = (req: MiniappRequest, res: Response, next: NextFunction) => {
        const isDebug = process.env.IS_MINIAPP_DEBUG_MODE === 'true';
        if (isDebug) {
            logger.info('Using test user db data');
            req.user = testData;
            next();
            return;
        }

        const token = req.cookies?.token as string | undefined;
        if (!token) {
            res.status(401).json({ error: 'Access denied' });
            return;
        }

        try {
            const jwtSecret = process.env.APP_ENCRYPTION_KEY ?? '';
            const decoded = jwt.verify(token, jwtSecret);
            req.user = decoded as Record<string, unknown>;
            next();
        } catch (error) {
            logger.error('Invalid token', { error });
            res.status(401).json({ error: 'Invalid token' });
        }
    };

    router.post('/tickets', requireAuth, async (req: MiniappRequest, res: Response) => {
        try {
            const userId = req.user?.id as string | undefined;
            if (!userId) {
                res.status(401).json({ error: 'Access denied' });
                return;
            }

            let data = await db
                .collection(COLLECTIONS.TASKS)
                .aggregate([
                    {
                        $match: {
                            is_deleted: { $ne: true },
                            'performer.id': userId,
                            task_status: {
                                $in: [
                                    TASK_STATUSES.READY_10,
                                    TASK_STATUSES.PROGRESS_10,
                                    TASK_STATUSES.PROGRESS_20,
                                    TASK_STATUSES.PROGRESS_30,
                                    TASK_STATUSES.PROGRESS_40,
                                    TASK_STATUSES.REVIEW_10,
                                    TASK_STATUSES.PERIODIC,
                                ],
                            },
                        },
                    },
                    {
                        $lookup: {
                            from: COLLECTIONS.WORK_HOURS,
                            localField: 'id',
                            foreignField: 'ticket_id',
                            as: 'work_data',
                        },
                    },
                    {
                        $lookup: {
                            from: COLLECTIONS.PROJECTS,
                            localField: 'project_id',
                            foreignField: '_id',
                            as: 'project_data',
                        },
                    },
                    { $unwind: { path: '$project_data', preserveNullAndEmptyArrays: true } },
                ])
                .toArray();

            const typesTreeData = await db.collection(COLLECTIONS.TASK_TYPES_TREE).find({}).toArray();
            const executionPlanItems = await db.collection(COLLECTIONS.EXECUTION_PLANS_ITEMS).find({}).toArray();
            const taskTypes: Record<string, unknown>[] = [];

            for (const element of typesTreeData) {
                const taskElement = element as Record<string, unknown>;
                taskElement.key = (taskElement._id as ObjectId).toString();
                if (taskElement.type_class === TASK_CLASSES.FUNCTIONALITY) {
                    continue;
                }
                const executionPlan = [] as Array<{ id: ObjectId; title: string }>;
                for (const item of taskElement.execution_plan as ObjectId[]) {
                    const planItem = executionPlanItems.find((i) => i._id.toString() === item.toString());
                    if (planItem) {
                        executionPlan.push({ id: planItem._id, title: planItem.title });
                    }
                }
                taskTypes.push({
                    _id: (taskElement._id as ObjectId).toString(),
                    key: (taskElement._id as ObjectId).toString(),
                    id: taskElement._id,
                    title: taskElement.title,
                    description: taskElement.description,
                    task_id: taskElement.task_id,
                    parent_type_id: taskElement.parent_type_id,
                    type_class: taskElement.type_class,
                    roles: taskElement.roles,
                    execution_plan: executionPlan,
                });
            }

            const typesTree = _.reduce(
                typesTreeData.filter((element) => (element as Record<string, unknown>).type_class === TASK_CLASSES.FUNCTIONALITY),
                (acc: Record<string, Record<string, unknown>>, element) => {
                    const key = (element as Record<string, unknown>)._id as ObjectId;
                    acc[key.toString()] = { ...element, children: [] } as Record<string, unknown>;
                    return acc;
                },
                {}
            );

            for (const element of taskTypes) {
                const parentId = element.parent_type_id as ObjectId | undefined;
                if (parentId) {
                    const parent = typesTree[parentId.toString()];
                    if (parent) {
                        element.parent = _.pick(parent, ['_id', 'title']);
                    }
                }
            }

            const taskTypesDict = taskTypes
                .filter((taskType) => taskType.type_class === TASK_CLASSES.TASK)
                .reduce((acc: Record<string, Record<string, unknown>>, element) => {
                    const id = (element._id as string).toString();
                    acc[id] = { ...element, children: [] } as Record<string, unknown>;
                    return acc;
                }, {});

            data = data.map((ticket) =>
                Object.assign(ticket, {
                    total_hours: (ticket.work_data as Array<{ work_hours: number }>).reduce(
                        (total, workHour) => total + workHour.work_hours,
                        0
                    ),
                    task_type: (taskTypesDict as Record<string, unknown>)[ticket.task_type as string] ?? null,
                    project: ticket?.project_data?.name ?? '',
                })
            );

            data = data.map((ticket) =>
                _.pick(ticket, [
                    '_id',
                    'id',
                    'name',
                    'project',
                    'task_status',
                    'priority',
                    'created_at',
                    'updated_at',
                    'task_type',
                    'description',
                    'epic',
                ])
            );

            res.status(200).json({ tickets: data });
        } catch (error) {
            logger.error('Tickets error', { error });
            res.status(500).json({ error: `${error}` });
        }
    });

    router.post('/tickets/set-status', requireAuth, async (req: MiniappRequest, res: Response) => {
        try {
            const now = Date.now();
            const ticketId = req.body.ticket as string;
            const newTaskStatus = req.body.newStatus as string;

            if (!Object.values(TASK_STATUSES).includes(newTaskStatus as (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES])) {
                res.status(500).json({ result: 'error' });
                return;
            }

            const ticket = await db.collection(COLLECTIONS.TASKS).findOne({ _id: new ObjectId(ticketId) });
            if (!ticket) {
                res.status(404).json({ result: 'not_found' });
                return;
            }

            if (ticket.task_status === TASK_STATUSES.PERIODIC) {
                res.status(500).json({ result: 'error' });
                return;
            }

            const updateProps: Record<string, unknown> = {
                updated_at: dayjs().format(),
                task_status: newTaskStatus,
            };

            const statusHistoryUpdate = {
                $push: {
                    task_status_history: {
                        old_value: ticket.task_status,
                        new_value: updateProps.task_status,
                        timestamp: now,
                        performer: (ticket.performer as { id?: string })?.id,
                    },
                },
                $set: {
                    last_status_update: now,
                    status_update_checked: false,
                },
            } as unknown as UpdateFilter<Record<string, unknown>>;

            await db.collection(COLLECTIONS.TASKS).updateOne({ _id: new ObjectId(ticketId) }, statusHistoryUpdate);

            await db.collection(COLLECTIONS.TASKS_HISTORY).insertOne({
                ticket_id: ticket.id,
                performer: (ticket.performer as { id?: string })?.id,
                property: 'task_status',
                old_value: ticket.task_status,
                new_value: updateProps.task_status,
                timestamp: now,
            });

            await notificationQueue.add(NOTIFICATIONS.TICKET_PROP_CHANGED, {
                task: ticket,
                prop: 'task_status',
                oldValue: ticket.task_status,
                newValue: updateProps.task_status,
            });

            await db.collection(COLLECTIONS.TASKS).updateOne({ _id: new ObjectId(ticketId) }, { $set: updateProps });

            res.status(200).json({ result: 'ok' });
        } catch (error) {
            logger.error('Set status error', { error });
            res.status(500).json({ error: `${error}` });
        }
    });

    router.post('/tickets/track-time', requireAuth, async (req: MiniappRequest, res: Response) => {
        try {
            const nowDate = dayjs().format();
            const ticketId = req.body.ticket_id as string;
            const comment = req.body.comment as string;
            const time = parseFloat(req.body.time as string);
            const date = dayjs(req.body.date as string, 'DD.MM.YY', true);
            const resultLink = req.body.result_link as string;

            if (!date.isValid()) {
                res.status(500).json({ result: 'error1' });
                return;
            }
            if (time.toString() !== req.body.time) {
                res.status(500).json({ result: 'error2' });
                return;
            }

            const ticket = await db
                .collection(COLLECTIONS.TASKS)
                .aggregate([
                    { $match: { _id: new ObjectId(ticketId) } },
                    {
                        $lookup: {
                            from: COLLECTIONS.PROJECTS,
                            localField: 'project',
                            foreignField: '_id',
                            as: 'project_data',
                        },
                    },
                    { $unwind: { path: '$project_data', preserveNullAndEmptyArrays: true } },
                ])
                .next();

            if (!ticket) {
                res.status(404).json({ result: 'not_found' });
                return;
            }

            const userId = req.user?.id as string | undefined;

            const workHoursObj = {
                date: date.add(12, 'hours').format(),
                date_timestamp: date.add(12, 'hours').unix(),
                description: comment,
                work_hours: time,
                ticket_id: ticket.id,
                ticket_db_id: ticketId,
                created_at: nowDate,
                edited_at: nowDate,
                created_by: userId,
                result_link: resultLink,
            };

            await db.collection(COLLECTIONS.WORK_HOURS).insertOne(workHoursObj);
            await notificationQueue.add(NOTIFICATIONS.NEW_WORK_HOURS_DATA, workHoursObj);

            const workHours = await db.collection(COLLECTIONS.WORK_HOURS).find({ ticket_id: ticket.id }).toArray();
            const totalHours = workHours.reduce((total, wh) => total + parseFloat(String(wh.work_hours)), 0.0);
            const estimatedTime = ticket.estimated_time as string | undefined;

            if (
                !_.isUndefined(estimatedTime) &&
                !_.isNull(estimatedTime) &&
                parseFloat(estimatedTime) > 0 &&
                totalHours - parseFloat(estimatedTime) > 0.5
            ) {
                const wheeNotification = {
                    ticket: { project: ticket?.project_data?.name ?? '', name: ticket.name },
                    performer: (req.user?.real_name as string | undefined) ?? '',
                    estimate: estimatedTime,
                    work_hours: totalHours,
                };

                await notificationQueue.add(NOTIFICATIONS.WH_ESTIMATE_EXCEEDED, wheeNotification);
            }

            res.status(200).json({ result: 'ok' });
        } catch (error) {
            logger.error('Track time error', { error });
            res.status(500).json({ error: `${error}` });
        }
    });

    router.post('/tickets/comment', requireAuth, async (req: MiniappRequest, res: Response) => {
        try {
            const ticketId = req.body.ticket_id as string;
            const commentText = req.body.comment as string;

            const user = _.pick(req.user, ['name', 'real_name', '_id', 'id']);

            const comment = {
                comment: commentText,
                created_at: Date.now(),
                author: user,
            };

            const commentUpdate = {
                $push: {
                    comments_list: comment,
                },
            } as unknown as UpdateFilter<Record<string, unknown>>;

            const opRes = await db.collection(COLLECTIONS.TASKS).updateOne({ _id: new ObjectId(ticketId) }, commentUpdate);

            res.status(200).json({ result: 'ok', op_res: opRes });
        } catch (error) {
            logger.error('Comment error', { error });
            res.status(500).json({ error: `${error}` });
        }
    });

    return router;
};
