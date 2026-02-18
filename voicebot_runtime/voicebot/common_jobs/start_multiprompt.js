
const ObjectId = require("mongodb").ObjectId;
const crypto = require("crypto");
const constants = require("../../constants");
const { Markup } = require("telegraf");

require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;
// Helper to escape MarkdownV2 special characters
function escapeMarkdownV2(text) {
    return text.replace(/[\\_\*\[\]\(\)~`>#+\-=|{}.!]/g, (match) => `\\${match}`);
}

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const session_id = job_data._id;

    const op_res = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        { _id: new ObjectId(session_id) },
        {
            $set: {
                is_waiting: true,
            }
        }
    );

    // Генерируем одноразовый токен для авторизации
    const oneTimeToken = crypto.randomBytes(32).toString('hex');

    // Сохраняем токен в базу данных
    await db.collection(constants.collections.ONE_USE_TOKENS).insertOne({
        token: oneTimeToken,
        chat_id: job_data.chat_id,
        created_at: new Date(),
        is_used: false
    });

    logger.info(`Generated one-time token for chat_id: ${job_data.chat_id}, token: ${oneTimeToken.substring(0, 8)}...`);

    const rawBase = (config.VOICE_WEB_INTERFACE_URL || "https://voice.stratospace.fun").replace(/\/+$/, "");
    const base = rawBase.includes("176.124.201.53") ? "https://voice.stratospace.fun" : rawBase;

    // Формируем ссылку на web-интерфейс с токеном

    const url = `${base}/tg_auth?token=${oneTimeToken}`;
    const before = escapeMarkdownV2("Новая сессия. Вы можете отправлять голосовые сообщения для транскрипции.\n\nДля доступа к web-интерфейсу перейдите по ссылке:");
    const linkText = escapeMarkdownV2("Ссылка на интерфейс");
    const after = escapeMarkdownV2("(однажды использованная ссылка будет недействительна, не передавайте её никому)");
    const text = rawBase.includes("localhost") ? `${before}\n ${escapeMarkdownV2(url)} \n\n${after}` : `${before}\n[${linkText}](${url})\n\n${after}`;

    const buttons = [Markup.button.url("WebRTC Client", `${base}/webrtc`)];

    await tgbot.telegram.sendMessage(
        job_data.chat_id,
        text,
        {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.inlineKeyboard(buttons).resize()
        }
    );


    logger.info(`Sent auth link to chat_id: ${job_data.chat_id}`);
}

module.exports = job_handler;

