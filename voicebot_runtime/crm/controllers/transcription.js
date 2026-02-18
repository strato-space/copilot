const ObjectId = require('mongodb').ObjectId;
const dayjs = require('dayjs');
const constants = require('../../constants');
const PermissionManager = require('../../permissions/permission-manager');
const { PERMISSIONS } = require('../../permissions/permissions-config');

const controller = {};

// Функция для генерации Markdown транскрипции
function generateTranscriptionMarkdown(session, messages) {
    const sessionDate = dayjs(session.created_at).format('DD.MM.YYYY HH:mm');
    const sessionEndDate = session.done_at ? dayjs(session.done_at).format('HH:mm') : 'не завершена';

    // let markdown = `# Транскрипция сессии\n\n`;
    // markdown += `**Дата:** ${sessionDate}\n`;
    // markdown += `**Время окончания:** ${sessionEndDate}\n`;
    // markdown += `**Название сессии:** ${session.session_name || 'Безымянная сессия'}\n`;

    // if (session.project?.name) {
    //     markdown += `**Проект:** ${session.project.name}\n`;
    // }

    // if (session.project?.client?.name) {
    //     markdown += `**Клиент:** ${session.project.client.name}\n`;
    // }

    // if (session.participants && session.participants.length > 0) {
    //     const participantNames = session.participants.map(p => p.name).join(', ');
    //     markdown += `**Участники:** ${participantNames}\n`;
    // }

    // markdown += `**Количество сообщений:** ${messages.length || 0}\n\n`;
    // markdown += `---\n\n`;
    // markdown += `## Транскрипция\n\n`;

    // messages
    let markdown = ""

    messages.sort((a, b) => {
        a.type = a?.source_type || constants.voice_message_sources.TELEGRAM;
        b.type = b?.source_type || constants.voice_message_sources.TELEGRAM;

        if (a.type !== constants.voice_message_sources.TELEGRAM || b.type !== constants.voice_message_sources.TELEGRAM) {
            if (a.message_timestamp < b.message_timestamp) return -1;
            if (a.message_timestamp > b.message_timestamp) return 1;
        }

        if (a.message_id < b.message_id) return -1;
        if (a.message_id > b.message_id) return 1;
        return 0;
    });

    if (messages && messages.length > 0) {
        messages.forEach((message, index) => {
            const timestamp = dayjs(message.created_at).format('HH:mm:ss');
            // const speaker = message.speaker_name || 'Неизвестный';
            const text = message.transcription_text || message.text || '';

            // markdown += `### ${index + 1}. ${speaker} (${timestamp})\n\n`;
            // markdown += `### ${index + 1}. (${timestamp})\n\n`;
            markdown += `${text}\n\n`;
        });
    } else {
        markdown += `*Сообщения не найдены*\n\n`;
    }

    return markdown;
}

// Контроллер для скачивания транскрипции сессии
controller.download = async (req, res) => {
    const { session_id } = req.params;
    const { db, logger, user, performer } = req;

    try {
        // Проверяем валидность ObjectId
        if (!ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: 'Invalid session ID' });
        }

        // Получаем данные сессии с полной информацией через агрегацию
        const sessionAggregation = await db.collection(constants.collections.VOICE_BOT_SESSIONS).aggregate([
            { $match: { _id: new ObjectId(session_id) } },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: constants.collections.PERFORMERS,
                    localField: "chat_id_str",
                    foreignField: "telegram_id",
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: constants.collections.PROJECTS,
                    localField: "project_id",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $lookup: {
                    from: constants.collections.CLIENTS,
                    let: { projectName: { $arrayElemAt: ["$project.name", 0] } },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $in: ["$$projectName", "$projects"] },
                                        { $ne: ["$is_active", false] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "client_info"
                }
            },
            {
                $lookup: {
                    from: constants.collections.PERSONS,
                    localField: "participants",
                    foreignField: "_id",
                    as: "participants_data"
                }
            },
            {
                $addFields: {
                    performer: { $arrayElemAt: ["$performer", 0] },
                    project: {
                        $mergeObjects: [
                            { $arrayElemAt: ["$project", 0] },
                            { client: { $arrayElemAt: ["$client_info", 0] } }
                        ]
                    },
                    participants: {
                        $map: {
                            input: { $ifNull: ["$participants_data", []] },
                            as: "participant",
                            in: {
                                _id: "$$participant._id",
                                name: "$$participant.name",
                                contacts: "$$participant.contacts"
                            }
                        }
                    }
                }
            }
        ]).toArray();

        if (!sessionAggregation || sessionAggregation.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const session = sessionAggregation[0];

        // Проверяем права доступа к этой сессии
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);

        let hasAccess = false;

        // Проверка прав по приоритету
        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            // Проверяем, является ли пользователь владельцем сессии
            if ((session.chat_id && session.chat_id.toString() === performer.telegram_id) ||
                (session.user_id && session.user_id.toString() === performer._id.toString())) {
                hasAccess = true;
            }
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this session" });
        }

        // Получаем сообщения сессии
        const messages = await db.collection(constants.collections.VOICE_BOT_MESSAGES)
            .find({ session_id: new ObjectId(session_id) })
            .sort({ created_at: 1 })
            .toArray();

        // Генерируем Markdown
        const markdown = generateTranscriptionMarkdown(session, messages);

        // Формируем имя файла
        const sessionDate = dayjs(session.created_at).format('YYYY-MM-DD_HH-mm');
        const sessionName = (session.session_name || 'session')
            .replace(/[^a-zA-Z0-9а-яА-Я_\-\s]/g, '') // Убираем специальные символы
            .replace(/\s+/g, '_') // Заменяем пробелы на подчеркивания
            .substring(0, 50); // Ограничиваем длину
        const filename = `transcription_${sessionDate}_${sessionName}.md`;

        // Устанавливаем заголовки для скачивания файла
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Content-Length', Buffer.byteLength(markdown, 'utf8'));
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

        logger.info(`Transcription downloaded for session ${session_id} by user ${user ? user.email : 'unknown'}`);

        // Отправляем файл
        res.send(markdown);

    } catch (error) {
        logger.error('Error downloading transcription:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = controller;
