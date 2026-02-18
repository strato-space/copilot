const ObjectId = require('mongodb').ObjectId;
const dayjs = require('dayjs');
const _ = require('lodash');
const constants = require('../../constants');
const PermissionManager = require('../../permissions/permission-manager');
const { PERMISSIONS } = require('../../permissions/permissions-config');
const controller = {};

// фильтрация по датам
// варианты выдачи - фулл и компакт
// mode=full - полная выдача crm
// mode=compact

controller.tickets = async (req, res) => {
    try {
        const { db, user, performer, logger } = req;
        const { task_statuses, project_id, mode } = req.body;

        let filter = {}

        // Фильтр по статусам: если указаны конкретные статусы - используем их,
        // иначе по умолчанию исключаем архивные тикеты
        if (task_statuses && Array.isArray(task_statuses) && task_statuses.length > 0) {
            filter.task_status = { $in: task_statuses }
        } else {
            filter.task_status = { $ne: constants.task_statuses.ARCHIVE }
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        const hasReadAllProjects = userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL);

        const user_accesible_projects = await PermissionManager.getUserAccessibleProjects(performer, db);
        const projectIds = user_accesible_projects.map(p => p._id || p);

        if (!hasReadAllProjects) {
            filter = { ...filter, project_id: { $in: projectIds } };
        }

        if (project_id) {
            const projectObjectId = new ObjectId(project_id);
            if (!hasReadAllProjects) {
                // Check if the requested project_id is in user's accessible projects
                const hasAccess = projectIds.some(id =>
                    (id._id || id).toString() === project_id.toString()
                );
                if (!hasAccess) {
                    return res.status(403).json({ error: 'Access denied to this project' });
                }
            }
            filter.project_id = projectObjectId;
        }

        let data = []
        if (mode == 'compact') {

            data = await db.collection(constants.collections.TASKS).aggregate([
                {
                    $match: {
                        "is_deleted": { $ne: true },
                        ...filter
                    }
                },
                {
                    $lookup: {
                        from: constants.collections.WORK_HOURS,
                        localField: "id",
                        foreignField: "ticket_id",
                        as: "work_data",
                    },
                },
            ]).toArray()
            // Apply date filtering for compact mode

            data = data.map(t => _.omit(Object.assign(t, {
                performer_id: t?.performer?._id ?? null
            }), ['performer']))

            data = data.map(t => {
                if (t.work_data) {
                    t.work_data = t.work_data.map(wd => {
                        delete wd.ticket_id;
                        delete wd.ticket_db_id;
                        if (wd.result_link === '-') delete wd.result_link;
                        return wd;
                    });
                }
                return t;
            });

        } else {
            data = await db.collection(constants.collections.TASKS).aggregate([
                {
                    $match: {
                        "is_deleted": { $ne: true },
                        ...filter
                    }
                },
                {
                    $lookup: {
                        from: constants.collections.WORK_HOURS,
                        localField: "id",
                        foreignField: "ticket_id",
                        as: "work_data",
                    },
                },
                {
                    $lookup: {
                        from: constants.collections.PROJECTS,
                        localField: "project_id",
                        foreignField: "_id",
                        as: "project_data"
                    }
                },
                { $unwind: { path: "$project_data", preserveNullAndEmptyArrays: true } }
                // {
                //   $project: {
                //     "work_data.work_hours": 1
                //   }
                // },
            ])
                .toArray()

            const types_tree_data = await db.collection(constants.collections.TASK_TYPES_TREE).find({}).toArray()
            const execution_plan_items = await db.collection(constants.collections.EXECUTION_PLANS_ITEMS).find({}).toArray()
            const task_types = []
            for (const element of types_tree_data) {
                element.key = element._id.toString()
                if (element.type_class === constants.task_classes.FUNCTIONALITY) {
                    continue
                }
                const execution_plan = []
                for (const item of element.execution_plan) {
                    const plan_item = execution_plan_items.find(i => i._id.toString() === item.toString())
                    if (plan_item) {
                        execution_plan.push({
                            id: plan_item._id,
                            title: plan_item.title
                        })
                    }
                }
                task_types.push({
                    _id: element._id.toString(),
                    key: element._id.toString(),
                    id: element._id,
                    title: element.title,
                    description: element.description,
                    task_id: element.task_id,
                    parent_type_id: element.parent_type_id,
                    type_class: element.type_class,
                    roles: element.roles,
                    execution_plan,
                })
            }

            const types_tree = _.reduce(types_tree_data.filter(element => element.type_class == constants.task_classes.FUNCTIONALITY),
                (acc, element) => {
                    acc[element._id.toString()] = { ...element, children: [] }
                    return acc
                }, {})

            for (const element of task_types) {
                const parent = types_tree[element.parent_type_id.toString()]
                if (parent) {
                    element.parent = _.pick(parent, ["_id", "title"])
                }
            }

            let task_types_dict = task_types.filter(tt => tt.type_class == constants.task_classes.TASK)
            task_types_dict = _.reduce(task_types_dict, (acc, element) => {
                acc[element._id.toString()] = { ...element, children: [] }
                return acc
            }, {})

            data = data.map(t => Object.assign(t, {
                task_type: task_types_dict[t.task_type] ?? null,
                project: { name: t?.project_data?.name ?? "", id: t?.project_data?._id },
            }))
        }

        const date_fields = ['created_at', 'updated_at', 'last_status_update']

        // Normalize all date fields to ISO strings first
        data = data.map(t => {
            // Normalize main date fields
            date_fields.forEach(field => {
                if (t[field]) {
                    // Check if field is unix timestamp (seconds) or javascript timestamp (milliseconds)
                    const value = t[field];
                    if (typeof value === 'number') {
                        // If less than 13 digits, it's likely unix timestamp (seconds)
                        // Convert to milliseconds for dayjs
                        const timestamp = value.toString().length <= 10 ? value * 1000 : value;
                        t[field] = dayjs(timestamp).toISOString();
                    } else {
                        // String date
                        t[field] = dayjs(value).toISOString();
                    }
                }
            });

            // Normalize work_data dates
            if (t.work_data) {
                t.work_data = t.work_data.map(wd => {
                    wd.date = wd.date ? dayjs(wd.date).toISOString() : null;
                    if (mode === 'compact') {
                        delete wd.created_at;
                        delete wd.edited_at;
                    } else {
                        wd.created_at = wd.created_at ? dayjs(wd.created_at).toISOString() : null;
                        wd.edited_at = wd.edited_at ? dayjs(wd.edited_at).toISOString() : null;
                    }
                    delete wd.date_timestamp;
                    return wd;
                });
            }

            // Normalize task_status_history dates
            if (t.task_status_history) {
                t.task_status_history = t.task_status_history.map(th => {
                    th.new = th.new_value;
                    th.old = th.old_value;
                    th.date = th.timestamp ? dayjs(th.timestamp).toISOString() : null;
                    delete th.new_value;
                    delete th.old_value;
                    delete th.timestamp;
                    return th;
                });
            }

            return t;
        });


        data = data.map(ticket => ({
            ...ticket,
            total_hours: ticket.work_data.reduce((total, wh) => total + wh.work_hours, 0)
        }));

        // Apply date filtering after normalization
        const { from, to } = req.body;

        if (from || to) {
            data = data.filter(ticket => {
                // Collect all dates from the ticket
                const dates = [];

                // Add main date fields
                if (ticket.created_at) dates.push(ticket.created_at);
                if (ticket.updated_at) dates.push(ticket.updated_at);
                if (ticket.last_status_update) dates.push(ticket.last_status_update);

                // Add work_data dates
                if (ticket.work_data) {
                    ticket.work_data.forEach(wd => {
                        if (wd.date) dates.push(wd.date);
                    });
                }

                // Add task_status_history dates
                if (ticket.task_status_history) {
                    ticket.task_status_history.forEach(th => {
                        if (th.date) dates.push(th.date);
                        if (th.timestamp) dates.push(th.timestamp);
                    });
                }

                // Check if any date falls within the range
                return dates.some(date => {
                    const dateObj = dayjs(date);
                    const fromCheck = !from || dateObj.isAfter(dayjs(from)) || dateObj.isSame(dayjs(from), 'day');
                    const toCheck = !to || dateObj.isBefore(dayjs(to));
                    return fromCheck && toCheck;
                });
            });

            data = data.map(ticket => {
                // Filter task_status_history by date field
                if (ticket.task_status_history) {
                    ticket.task_status_history = ticket.task_status_history.filter(history => {
                        if (!history.date) return true;
                        const historyDate = dayjs(history.date);
                        const fromCheck = !from || historyDate.isAfter(dayjs(from)) || historyDate.isSame(dayjs(from), 'day');
                        const toCheck = !to || historyDate.isBefore(dayjs(to));
                        return fromCheck && toCheck;
                    });
                }

                // Filter work_data by date field
                if (ticket.work_data) {
                    ticket.work_data = ticket.work_data.filter(workItem => {
                        if (!workItem.date) return true;
                        const workDate = dayjs(workItem.date);
                        const fromCheck = !from || workDate.isAfter(dayjs(from)) || workDate.isSame(dayjs(from), 'day');
                        const toCheck = !to || workDate.isBefore(dayjs(to));
                        return fromCheck && toCheck;
                    });
                }
                return ticket;
            });

            data = data.map(ticket => ({
                ...ticket,
                hours_by_period: ticket.work_data.reduce((total, wh) => total + wh.work_hours, 0)
            }));
        }

        data = data.map(t => _.omitBy(t, _.isNull));

        return res.status(200).json(data);

    } catch (error) {
        logger.error('Error in tickets controller:', error)
        res.status(500).json({ error: `${error}` });
    }
};

controller.getDictionary = async (req, res) => {
    const { db, user, logger } = req;

    try {
        // Получаем дерево проектов через агрегацию от верхнеуровневой коллекции Customers
        const customersTree = await db.collection(constants.collections.CUSTOMERS).aggregate([
            {
                $match: { is_active: { $ne: false } }
            },
            {
                $lookup: {
                    from: constants.collections.PROJECT_GROUPS,
                    let: { groupIds: "$project_groups_ids" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $in: ["$_id", "$$groupIds"] },
                                        { $ne: ["$is_active", false] }
                                    ]
                                }
                            }
                        },
                        {
                            $lookup: {
                                from: constants.collections.PROJECTS,
                                let: { projectIds: "$projects_ids" },
                                pipeline: [
                                    {
                                        $match: {
                                            $expr: {
                                                $and: [
                                                    { $in: ["$_id", "$$projectIds"] },
                                                    { $ne: ["$is_active", false] }
                                                ]
                                            }
                                        }
                                    },
                                    {
                                        $project: {
                                            _id: 1,
                                            name: 1,
                                            type: { $literal: "project" }
                                        }
                                    }
                                ],
                                as: "children"
                            }
                        },
                        {
                            $project: {
                                _id: 1,
                                name: 1,
                                type: { $literal: "group" },
                                children: 1
                            }
                        }
                    ],
                    as: "children"
                }
            },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    type: { $literal: "customer" },
                    children: 1
                }
            }
        ]).toArray();

        const tree = customersTree;

        const types_tree_data = await db.collection(constants.collections.TASK_TYPES_TREE).find({}).toArray()
        let task_types = []
        for (const element of types_tree_data) {
            element.key = element._id.toString()
            if (element.type_class === constants.task_classes.FUNCTIONALITY) {
                continue
            }

            task_types.push({
                _id: element._id.toString(),
                key: element._id.toString(),
                id: element._id,
                title: element.title,
                description: element.description,
                task_id: element.task_id,
                parent_type_id: element.parent_type_id,
                type_class: element.type_class,
                roles: element.roles,
            })
        }

        const types_tree = _.reduce(types_tree_data.filter(element => element.type_class == constants.task_classes.FUNCTIONALITY),
            (acc, element) => {
                acc[element._id.toString()] = { ...element, children: [] }
                return acc
            }, {})

        for (const element of task_types) {
            element.name = element.title
            element.supertype_id = element.parent_type_id
            const parent = types_tree[element.parent_type_id.toString()]
            if (parent) {
                element.supertype = types_tree[element.parent_type_id.toString()]?.title
                element.long_name = element.supertype + ": " + element.title

                element.parent = _.pick(parent, ["_id", "title"])
                parent.children.push(element)
            }
        }

        const performers = await db.collection(constants.collections.PERFORMERS).find({ is_active: true }).project({
            monthly_payment: 0,
            payment_bonuses: 0,
            payment_info: 0,
            payments_settings: 0,
            password_hash: 0,
            password_updated_at: 0,
            google_drive_name: 0,
        }).toArray()

        task_types = _.reduce(task_types, (result, obj) => {
            result[obj._id.toString()] = obj;
            return result;
        }, {});

        const task_statuses = constants.task_statuses;

        return res.status(200).json({
            tree,
            task_types,
            performers,
            task_statuses
        });
    } catch (error) {
        logger.error(error)
        return res.status(500).json({ error: `${error}` });
    }
}


module.exports = controller;
