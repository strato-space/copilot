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

module.exports = {
    apps: [
        // ============================================
        // Copilot Agent Services - интеллектуальная обработка диалогов
        // Порт: 8722 (отличается от voicebot: 8721)
        // ============================================
        {
            name: 'copilot-agent-services',
            script: '.venv/bin/fast-agent',
            cwd: __dirname,
            interpreter: '.venv/bin/python',
            env_file: '../backend/.env',
            args: [
                'serve',
                '--config-path', 'fastagent.config.yaml',
                '--agent-cards', 'agent-cards',
                '--name', 'copilot-agent-services',
                '--transport', 'http',
                '--host', '0.0.0.0',
                '--port', '8722',
                '--instance-scope', 'request',
                '--description', 'Copilot Agent Services for intelligent dialogue processing'
            ],
            instances: 1,
            exec_mode: 'fork_mode',
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                PYTHONUNBUFFERED: '1',
            },
            error_file: './logs/copilot-agents-services.log',
            out_file: './logs/copilot-agents-services.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
        },
    ],
};
