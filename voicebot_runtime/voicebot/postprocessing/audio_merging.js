require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const ObjectId = require("mongodb").ObjectId;
const constants = require("../../constants");
const prompts = require("../prompts/manifest");
const { toFile } = require("openai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require('child_process');
const axios = require("axios");
const dayjs = require('dayjs');

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const { session_id } = job_data;
    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({ _id: new ObjectId(session_id) });
    const chat_id = session.chat_id;

    const voice_messages = await db.collection(constants.collections.VOICE_BOT_MESSAGES).find({
        session_id: new ObjectId(session_id),
        source_type: constants.voice_message_sources.TELEGRAM,
        file_unique_id: { $ne: null } // skip text messages
    }).sort({ message_id: 1 }).toArray();
    //TODO: добавить корректное склеивание для загруженных файлов с правильной сортировкой
    const files = [];
    for (const message of voice_messages) {
        const file_id = message.file_id;
        const fileLink = await tgbot.telegram.getFileLink(file_id);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const audioBuffer = response.data;

        // Save to temp directory as .oga
        const tempDir = os.tmpdir();
        const fileName = `speech-${message.chat_id}-${message.message_id}.oga`;
        const tempFilePath = path.join(tempDir, fileName);
        fs.writeFileSync(tempFilePath, audioBuffer);

        if (logger) logger.info(`Saved audio file to temp: ${tempFilePath}`);
        files.push(tempFilePath);
    }

    // Merge audio files using ffmpeg (oga -> oga, затем опционально convert to mp3)
    if (files.length > 1) {
        const tempDir = os.tmpdir();
        const mergedOgaName = `merged-speech-${session_id || Date.now()}.oga`;
        const mergedOgaPath = path.join(tempDir, mergedOgaName);

        // Create a file list for ffmpeg
        const fileListPath = path.join(tempDir, `ffmpeg-filelist-${session_id || Date.now()}.txt`);
        const fileListContent = files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(fileListPath, fileListContent);

        let mergedMp3Path = null;
        let mergedMp3Name = null;
        let mergedAudioPath = mergedOgaPath;
        let mergedAudioName = mergedOgaName;
        const convertToMp3 = (config.CONVERT_TO_MP3 || '').toLowerCase() === 'true';
        try {
            // Merge to .oga
            const ffmpegPath = config.FFMPEG_PATH || 'ffmpeg';
            execSync(`${ffmpegPath} -y -f concat -safe 0 -i "${fileListPath}" -c copy "${mergedOgaPath}"`);
            if (logger) logger.info(`Merged OGA audio file created at: ${mergedOgaPath}`);

            if (convertToMp3) {
                // Convert merged .oga to .mp3
                mergedMp3Name = `merged-speech-${dayjs().format('YYYY-MM-DD HH:mm')}-${session_id}.mp3`;
                mergedMp3Path = path.join(tempDir, mergedMp3Name);
                execSync(`${ffmpegPath} -y -i "${mergedOgaPath}" -codec:a libmp3lame -qscale:a 2 "${mergedMp3Path}"`);
                if (logger) logger.info(`Converted merged audio to mp3: ${mergedMp3Path}`);
                // Remove merged .oga after conversion
                fs.unlinkSync(mergedOgaPath);
                mergedAudioPath = mergedMp3Path;
                mergedAudioName = mergedMp3Name;
            }
        } catch (err) {
            if (logger) logger.error('ffmpeg merge/convert error:', err);
            throw err;
        }
        // Remove the file list after merging
        fs.unlinkSync(fileListPath);

        // Remove all original audio files
        for (const f of files) {
            try {
                fs.unlinkSync(f);
                if (logger) logger.info(`Removed temp audio file: ${f}`);
            } catch (err) {
                if (logger) logger.warn(`Failed to remove temp audio file: ${f}`);
            }
        }

        // Send merged audio file to Telegram
        if (mergedAudioPath) {
            const stream = fs.createReadStream(mergedAudioPath);
            await tgbot.telegram.sendAudio(
                chat_id,
                { source: stream, filename: mergedAudioName },
                { title: 'Merged Voice Messages' }
            );
            if (logger) logger.info(`Sent merged audio file to chat_id: ${chat_id}`);
            stream.close();
            // Optionally, remove merged audio after sending
            try {
                fs.unlinkSync(mergedAudioPath);
                if (logger) logger.info(`Removed merged audio file: ${mergedAudioPath}`);
            } catch (err) {
                if (logger) logger.warn(`Failed to remove merged audio file: ${mergedAudioPath}`);
            }
        }
    }
}
module.exports = job_handler;