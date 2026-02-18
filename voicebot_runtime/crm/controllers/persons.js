const ObjectId = require("mongodb").ObjectId;
const constants = require("../../constants");

const controller = {};

/**
 * Получить список всех персон
 * Возвращает: _id, name, projects, performer
 */
controller.listAll = async (req, res) => {
    try {
        const { db, user, logger } = req;

        const result = await db.collection(constants.collections.PERSONS).aggregate([
            // Подгружаем данные исполнителя
            {
                $lookup: {
                    from: constants.collections.PERFORMERS,
                    localField: "performer_id",
                    foreignField: "_id",
                    as: "performer_data"
                }
            },
            // Для каждого проекта в массиве projects подгружаем данные проекта
            {
                $addFields: {
                    projects_with_data: {
                        $map: {
                            input: { $ifNull: ["$projects", []] },
                            as: "project_item",
                            in: {
                                project_id: "$$project_item.project_id",
                                role: "$$project_item.role",
                                project_data: {
                                    $let: {
                                        vars: {
                                            projectId: "$$project_item.project_id"
                                        },
                                        in: "$$projectId"
                                    }
                                }
                            }
                        }
                    }
                }
            },
            // Подгружаем данные проектов через отдельный lookup
            {
                $lookup: {
                    from: constants.collections.PROJECTS,
                    let: { projectIds: { $map: { input: { $ifNull: ["$projects", []] }, as: "p", in: "$$p.project_id" } } },
                    pipeline: [
                        { $match: { $expr: { $in: ["$_id", "$$projectIds"] } } }
                    ],
                    as: "projects_lookup"
                }
            },
            // Формируем финальную структуру
            {
                $addFields: {
                    performer: {
                        $let: {
                            vars: { performerData: { $arrayElemAt: ["$performer_data", 0] } },
                            in: {
                                $cond: {
                                    if: { $ne: ["$$performerData", null] },
                                    then: {
                                        _id: "$$performerData._id",
                                        name: { $ifNull: ["$$performerData.name", "$$performerData.real_name"] },
                                        corporate_email: "$$performerData.corporate_email"
                                    },
                                    else: null
                                }
                            }
                        }
                    },
                    projects: {
                        $map: {
                            input: { $ifNull: ["$projects", []] },
                            as: "project_item",
                            in: {
                                project_id: "$$project_item.project_id",
                                role: "$$project_item.role",
                                project: {
                                    $let: {
                                        vars: {
                                            projectData: {
                                                $arrayElemAt: [
                                                    {
                                                        $filter: {
                                                            input: "$projects_lookup",
                                                            cond: { $eq: ["$$this._id", "$$project_item.project_id"] }
                                                        }
                                                    },
                                                    0
                                                ]
                                            }
                                        },
                                        in: {
                                            $cond: {
                                                if: { $ne: ["$$projectData", null] },
                                                then: {
                                                    _id: "$$projectData._id",
                                                    name: "$$projectData.name",
                                                    description: "$$projectData.description"
                                                },
                                                else: null
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            // Убираем служебные поля
            {
                $project: {
                    _id: 1,
                    name: 1,
                    projects: 1,
                    performer: 1
                }
            }
        ]).toArray();

        logger.info(`Listed ${result.length} persons for user: ${user.email}`);
        res.json(result);

    } catch (error) {
        req.logger.error('Error in listAll persons:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * Получить полную информацию о персоне по ID
 */
controller.getById = async (req, res) => {
    try {
        const { db, user, logger } = req;
        const { id } = req.body;

        // Валидация ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid person ID" });
        }

        const result = await db.collection(constants.collections.PERSONS).aggregate([
            // Фильтруем по ID
            { $match: { _id: new ObjectId(id) } },

            // Подгружаем данные исполнителя
            {
                $lookup: {
                    from: constants.collections.PERFORMERS,
                    localField: "performer_id",
                    foreignField: "_id",
                    as: "performer_data"
                }
            },

            // Подгружаем данные проектов
            {
                $lookup: {
                    from: constants.collections.PROJECTS,
                    let: { projectIds: { $map: { input: { $ifNull: ["$projects", []] }, as: "p", in: "$$p.project_id" } } },
                    pipeline: [
                        { $match: { $expr: { $in: ["$_id", "$$projectIds"] } } }
                    ],
                    as: "projects_lookup"
                }
            },

            // Формируем финальную структуру с полными данными
            {
                $addFields: {
                    performer: {
                        $let: {
                            vars: { performerData: { $arrayElemAt: ["$performer_data", 0] } },
                            in: {
                                $cond: {
                                    if: { $ne: ["$$performerData", null] },
                                    then: {
                                        _id: "$$performerData._id",
                                        name: { $ifNull: ["$$performerData.name", "$$performerData.real_name"] },
                                        corporate_email: "$$performerData.corporate_email",
                                        telegram_id: "$$performerData.telegram_id",
                                        role: "$$performerData.role"
                                    },
                                    else: null
                                }
                            }
                        }
                    },
                    projects: {
                        $map: {
                            input: { $ifNull: ["$projects", []] },
                            as: "project_item",
                            in: {
                                project_id: "$$project_item.project_id",
                                role: "$$project_item.role",
                                project: {
                                    $let: {
                                        vars: {
                                            projectData: {
                                                $arrayElemAt: [
                                                    {
                                                        $filter: {
                                                            input: "$projects_lookup",
                                                            cond: { $eq: ["$$this._id", "$$project_item.project_id"] }
                                                        }
                                                    },
                                                    0
                                                ]
                                            }
                                        },
                                        in: "$$projectData"
                                    }
                                }
                            }
                        }
                    },
                    contacts: { $ifNull: ["$contacts", {}] }
                }
            },

            // Убираем служебные поля
            {
                $project: {
                    _id: 1,
                    name: 1,
                    contacts: 1,
                    projects: 1,
                    performer: 1,
                    created_at: 1,
                    updated_at: 1
                }
            }
        ]).toArray();

        if (!result || result.length === 0) {
            return res.status(404).json({ error: "Person not found" });
        }

        logger.info(`Retrieved person ${id} for user: ${user.email}`);
        res.json(result[0]);

    } catch (error) {
        req.logger.error('Error in getById person:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * Создать новую персону
 */
controller.create = async (req, res) => {
    try {
        const { db, user, logger } = req;
        const { name, contacts, projects, performer_id } = req.body;

        // Валидация обязательных полей
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: "Name is required and must be a non-empty string" });
        }

        // Валидация контактов
        if (contacts && typeof contacts !== 'object') {
            return res.status(400).json({ error: "Contacts must be an object" });
        }

        // Валидация проектов
        if (projects && !Array.isArray(projects)) {
            return res.status(400).json({ error: "Projects must be an array" });
        }

        // Валидация performer_id
        if (performer_id && !ObjectId.isValid(performer_id)) {
            return res.status(400).json({ error: "Invalid performer_id" });
        }

        // Проверяем существование исполнителя
        if (performer_id) {
            const performer = await db.collection(constants.collections.PERFORMERS).findOne({ _id: new ObjectId(performer_id) });
            if (!performer) {
                return res.status(400).json({ error: "Performer not found" });
            }
        }

        // Проверяем существование проектов
        if (projects && projects.length > 0) {
            const projectIds = projects.map(p => new ObjectId(p.project_id)).filter(id => ObjectId.isValid(id));
            if (projectIds.length !== projects.length) {
                return res.status(400).json({ error: "Invalid project_id in projects array" });
            }

            const existingProjects = await db.collection(constants.collections.PROJECTS).find({ _id: { $in: projectIds } }).toArray();
            if (existingProjects.length !== projectIds.length) {
                return res.status(400).json({ error: "Some projects not found" });
            }
        }

        // Преобразуем project_id в ObjectId для проектов
        const processedProjects = projects ? projects.map(project => ({
            ...project,
            project_id: new ObjectId(project.project_id)
        })) : [];

        // Создаем документ персоны
        const personDoc = {
            name: name.trim(),
            contacts: contacts || {},
            projects: processedProjects,
            performer_id: performer_id ? new ObjectId(performer_id) : null,
            created_at: new Date(),
            updated_at: new Date()
        };

        // Сохраняем в базу
        const result = await db.collection(constants.collections.PERSONS).insertOne(personDoc);

        logger.info(`Created person ${result.insertedId} by user: ${user.email}`);
        res.status(201).json({
            _id: result.insertedId,
            message: "Person created successfully"
        });

    } catch (error) {
        req.logger.error('Error in create person:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * Обновить персону
 */
controller.update = async (req, res) => {
    try {
        const { db, user, logger } = req;
        const { id, name, contacts, projects, performer_id } = req.body;

        // Валидация ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid person ID" });
        }

        // Проверяем существование персоны
        const existingPerson = await db.collection(constants.collections.PERSONS).findOne({ _id: new ObjectId(id) });
        if (!existingPerson) {
            return res.status(404).json({ error: "Person not found" });
        }

        // Валидация данных
        const updateDoc = {
            updated_at: new Date()
        };

        if (name !== undefined) {
            if (typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: "Name must be a non-empty string" });
            }
            updateDoc.name = name.trim();
        }

        if (contacts !== undefined) {
            if (typeof contacts !== 'object') {
                return res.status(400).json({ error: "Contacts must be an object" });
            }
            updateDoc.contacts = contacts;
        }

        if (projects !== undefined) {
            if (!Array.isArray(projects)) {
                return res.status(400).json({ error: "Projects must be an array" });
            }

            // Проверяем существование проектов
            if (projects.length > 0) {
                const projectIds = projects.map(p => new ObjectId(p.project_id)).filter(id => ObjectId.isValid(id));
                if (projectIds.length !== projects.length) {
                    return res.status(400).json({ error: "Invalid project_id in projects array" });
                }

                const existingProjects = await db.collection(constants.collections.PROJECTS).find({ _id: { $in: projectIds } }).toArray();
                if (existingProjects.length !== projectIds.length) {
                    return res.status(400).json({ error: "Some projects not found" });
                }
            }

            // Преобразуем project_id в ObjectId для проектов
            const processedProjects = projects.map(project => ({
                ...project,
                project_id: new ObjectId(project.project_id)
            }));

            updateDoc.projects = processedProjects;
        }

        if (performer_id !== undefined) {
            if (performer_id === null) {
                updateDoc.performer_id = null;
            } else {
                if (!ObjectId.isValid(performer_id)) {
                    return res.status(400).json({ error: "Invalid performer_id" });
                }

                const performer = await db.collection(constants.collections.PERFORMERS).findOne({ _id: new ObjectId(performer_id) });
                if (!performer) {
                    return res.status(400).json({ error: "Performer not found" });
                }

                updateDoc.performer_id = new ObjectId(performer_id);
            }
        }

        // Обновляем документ
        await db.collection(constants.collections.PERSONS).updateOne(
            { _id: new ObjectId(id) },
            { $set: updateDoc }
        );

        logger.info(`Updated person ${id} by user: ${user.email}`);
        res.json({ message: "Person updated successfully" });

    } catch (error) {
        req.logger.error('Error in update person:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * Удалить персону
 */
controller.delete = async (req, res) => {
    try {
        const { db, user, logger } = req;
        const { id } = req.body;

        // Валидация ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid person ID" });
        }

        // Проверяем существование персоны
        const existingPerson = await db.collection(constants.collections.PERSONS).findOne({ _id: new ObjectId(id) });
        if (!existingPerson) {
            return res.status(404).json({ error: "Person not found" });
        }

        // Удаляем персону
        await db.collection(constants.collections.PERSONS).deleteOne({ _id: new ObjectId(id) });

        logger.info(`Deleted person ${id} by user: ${user.email}`);
        res.json({ message: "Person deleted successfully" });

    } catch (error) {
        req.logger.error('Error in delete person:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

controller.listPerformers = async (req, res) => {
    try {
        const { db, user, logger } = req;
        const performers = await db.collection(constants.collections.PERFORMERS).find({is_active:true}).project({
            _id: 1,
            id: 1,
            name: 1,
            real_name: 1,
            telegram_id: 1,
            telegram_name: 1,
            corporate_email: 1,
            is_deleted: 1,
        }).toArray();

        res.json(performers);
    } catch (error) {
        req.logger.error('Error in listPerformers:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

module.exports = controller;
