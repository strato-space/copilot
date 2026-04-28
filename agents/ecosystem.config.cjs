/**
 * PM2 Ecosystem конфигурация для Fast-Agent MCP серверов (Copilot)
 * 
 * Запуск всех агентов:
 *   ./pm2-agents.sh start
 * 
 * Остановка всех агентов:
 *   ./pm2-agents.sh stop
 * 
 * Перезапуск всех агентов:
 *   ./pm2-agents.sh restart
 * 
 * Просмотр логов:
 *   ./pm2-agents.sh logs
 * 
 * Мониторинг:
 *   ./pm2-agents.sh monit
 */

const fs = require('fs');
const path = require('path');

const backendProdEnvFilePath = path.resolve(__dirname, '../backend/.env.production');

const parseEnvFile = (filePath) => {
    if (!fs.existsSync(filePath)) return {};

    const env = {};
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    for (const rawLine of lines) {
        const line = String(rawLine || '').trim();
        if (!line || line.startsWith('#')) continue;

        const idx = line.indexOf('=');
        if (idx <= 0) continue;

        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        env[key] = value;
    }

    return env;
};

const backendProdEnv = parseEnvFile(backendProdEnvFilePath);

module.exports = {
    apps: [
        // ============================================
        // Copilot Agent Services - интеллектуальная обработка диалогов
        // Порт: 8722 (отличается от voicebot: 8721)
        // ============================================
        {
            name: 'copilot-agent-services',
            script: 'uv',
            cwd: __dirname,
            interpreter: 'none',
            env_file: backendProdEnvFilePath,
            args: [
                'run',
                '--directory', __dirname,
                'python',
                'run_fast_agent.py',
                'serve',
                '--config-path', 'fastagent.config.yaml',
                '--agent-cards', 'agent-cards',
                '--name', 'copilot-agent-services',
                '--transport', 'http',
                '--host', '127.0.0.1',
                '--port', '8722',
                '--instance-scope', 'request',
                '--watch',
                '--description', 'Copilot Agent Services for intelligent dialogue processing'
            ],
            instances: 1,
            exec_mode: 'fork_mode',
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                ...backendProdEnv,
                PYTHONUNBUFFERED: '1',
                CODEX_AUTH_JSON_PATH: `${__dirname}/.codex/auth.json`,
            },
            error_file: './logs/copilot-agents-services.log',
            out_file: './logs/copilot-agents-services.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
        },
    ],
};
