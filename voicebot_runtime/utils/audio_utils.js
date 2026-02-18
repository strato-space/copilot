const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const constants = require('../constants');

/**
 * Получить длительность аудио файла с помощью ffprobe
 */
const getAudioDuration = async (filePath) => {
    try {
        const probe = spawnSync(
            'ffprobe',
            [
                '-v',
                'error',
                '-show_entries',
                'format=duration:stream=duration',
                '-of',
                'json',
                filePath
            ],
            { encoding: 'utf8' }
        );

        if (probe.error) {
            throw probe.error;
        }
        if (probe.status !== 0) {
            throw new Error((probe.stderr || '').trim() || `ffprobe exited with status ${probe.status}`);
        }

        const raw = (probe.stdout || '').trim();
        if (!raw) {
            throw new Error('Empty ffprobe output');
        }

        const parsed = JSON.parse(raw);
        const candidates = [];

        const formatDuration = Number(parsed?.format?.duration);
        if (Number.isFinite(formatDuration) && formatDuration > 0) {
            candidates.push(formatDuration);
        }

        if (Array.isArray(parsed?.streams)) {
            for (const stream of parsed.streams) {
                const streamDuration = Number(stream?.duration);
                if (Number.isFinite(streamDuration) && streamDuration > 0) {
                    candidates.push(streamDuration);
                }
            }
        }

        if (candidates.length === 0) {
            throw new Error('Duration is unavailable in ffprobe metadata');
        }

        return Math.max(...candidates);
    } catch (error) {
        throw new Error(`Unable to read audio duration: ${error.message}`);
    }
};

/**
 * Вычислить хэш файла для дедупликации
 */
const calculateFileHash = (buffer) => {
    return crypto.createHash('sha256')
        .update(buffer)
        .digest('hex')
        .substring(0, 16);
};

/**
 * Переместить файл из временной папки в папку сессии
 */
const moveToSessionFolder = (tempPath, sessionId, hash, extension) => {
    const sessionDir = path.join(constants.file_storage.AUDIO_DIR, 'sessions', sessionId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const timestamp = Date.now();
    const filename = `${timestamp}_${hash}.${extension}`;
    const finalPath = path.join(sessionDir, filename);

    fs.renameSync(tempPath, finalPath);
    return finalPath;
};

/**
 * Валидация аудио файла
 */
const validateAudioFile = (file) => {
    const errors = [];

    if (file.size > constants.file_storage.MAX_FILE_SIZE) {
        errors.push(`File too large. Maximum size: ${constants.file_storage.MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (!constants.file_storage.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        errors.push(`Unsupported file type: ${file.mimetype}`);
    }

    return { valid: errors.length === 0, errors };
};

/**
 * Получить аудио буфер в зависимости от источника сообщения
 */
const getAudioBuffer = async (message, tgbot, logger) => {
    // Определяем источник сообщения по наличию свойств
    let sourceType = message.source_type;

    if (!sourceType) {
        // Автоматическое определение источника по свойствам сообщения
        if (message.file_id) {
            sourceType = constants.voice_message_sources.TELEGRAM;
        } else if (message.file_path) {
            sourceType = constants.voice_message_sources.WEB;
        } else {
            throw new Error('Cannot determine message source type: no file_id or file_path found');
        }
    }

    if (sourceType === constants.voice_message_sources.TELEGRAM) {
        // Существующая логика через Telegram API
        const axios = require('axios');
        const fileLink = await tgbot.telegram.getFileLink(message.file_id);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        return response.data;
    } else if (sourceType === constants.voice_message_sources.WEB) {
        // Загрузка из файловой системы
        return fs.readFileSync(message.file_path);
    } else {
        throw new Error(`Unknown message source type: ${sourceType}`);
    }
};

/**
 * Очистка старых временных файлов
 */
const cleanupTempFiles = async () => {
    const tempDir = constants.file_storage.TEMP_DIR;
    if (!fs.existsSync(tempDir)) return;

    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 часа

    for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
            try {
                fs.unlinkSync(filePath);
            } catch (error) {
                console.warn(`Failed to remove temp file: ${filePath}`, error);
            }
        }
    }
};

module.exports = {
    getAudioDuration,
    calculateFileHash,
    moveToSessionFolder,
    validateAudioFile,
    getAudioBuffer,
    cleanupTempFiles
};
