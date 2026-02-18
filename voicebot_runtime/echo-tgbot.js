require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const uuid = require('uuid');
const CryptoJS = require("crypto-js");

const _ = require('lodash');

const { Telegraf, Markup, Input, Scenes, session } = require("telegraf");
const { SocksProxyAgent } = require('socks-proxy-agent');


let tgbot = null;


; (async function () {
    try {
        tgbot = new Telegraf(config.TG_VOICE_BOT_TOKEN);

        tgbot.on('message', async (ctx) => {
            tgbot.telegram.sendMessage(
                ctx.message.chat.id,
                JSON.stringify(ctx.message)
            );
        });

        tgbot.catch(err => {
            console.error("TGBot catched error:")
            console.error(err)
        });

        tgbot.launch();

        console.log('Telegram bot started');

        // Graceful shutdown handlers
        const gracefulShutdown = async (signal) => {
            console.info(`Received ${signal}. Starting graceful shutdown...`);

            try {
                // 1. Остановить Telegram бота
                if (tgbot) {
                    await tgbot.stop();
                    console.info('Telegram bot stopped');
                }
                console.info('Graceful shutdown completed');
                process.exit(0);
            } catch (error) {
                console.error('Error during graceful shutdown:', error);
                process.exit(1);
            }
        };

        // Обработчики сигналов завершения
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        // Обработчик необработанных ошибок
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            gracefulShutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            gracefulShutdown('unhandledRejection');
        });

    } catch (e) {
        console.error(e);
    }
})();

