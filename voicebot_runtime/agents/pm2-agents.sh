#!/usr/bin/env bash
#
# PM2 Management Script for Voicebot Agent Services
#

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${BLUE}→ $1${NC}"; }

# Проверка PM2
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        print_error "PM2 не установлен. Установите: npm install -g pm2"
        exit 1
    fi
}

# Проверка окружения
check_venv() {
    if [ ! -f ".venv/bin/fast-agent" ]; then
        print_error "fast-agent не найден в .venv. Создайте окружение: uv venv && uv pip install -e ."
        exit 1
    fi
}

check_agent_cards() {
    if [ ! -d "agent-cards" ]; then
        print_error "Каталог agent-cards не найден. Добавьте AgentCards в ./agent-cards."
        exit 1
    fi
    if ! compgen -G "agent-cards/*.md" >/dev/null \
        && ! compgen -G "agent-cards/*.yml" >/dev/null \
        && ! compgen -G "agent-cards/*.yaml" >/dev/null; then
        print_error "В agent-cards нет файлов AgentCard (.md/.yml/.yaml)."
        exit 1
    fi
}

# Создание директории логов
create_logs_dir() {
    [ ! -d "logs" ] && mkdir -p logs || true
}

# Команды управления
start_services() {
    check_pm2
    check_venv
    check_agent_cards
    create_logs_dir
    
    print_info "Запуск Voicebot Agent Services..."
    # pm2 start возвращает ненулевой код, если процесс уже запущен (делает restart)
    set +e
    pm2 start ecosystem.config.cjs
    set -e
    print_success "Сервис запущен на http://0.0.0.0:8721"
}

stop_services() {
    check_pm2
    print_info "Остановка сервиса..."
    pm2 stop ecosystem.config.cjs
    print_success "Сервис остановлен"
}

restart_services() {
    check_pm2
    print_info "Перезапуск сервиса..."
    pm2 restart ecosystem.config.cjs
    print_success "Сервис перезапущен"
}

delete_services() {
    check_pm2
    print_info "Удаление сервиса из PM2..."
    pm2 delete ecosystem.config.cjs 2>/dev/null || true
    print_success "Сервис удалён"
}

# Главное меню
case "${1:-}" in
    start)
        start_services
        ;;
    stop)
        check_pm2
        stop_services
        ;;
    restart)
        check_pm2
        restart_services
        ;;
    delete)
        check_pm2
        delete_services
        ;;
    status)
        check_pm2
        pm2 status
        ;;
    logs)
        check_pm2
        pm2 logs voicebot-agent-services
        ;;
    monit)
        check_pm2
        pm2 monit
        ;;
    save)
        check_pm2
        pm2 save
        print_success "Список процессов сохранён"
        ;;
    *)
        echo "Использование: $0 {start|stop|restart|delete|status|logs|monit|save}"
        echo ""
        echo "Команды:"
        echo "  start    - Запустить сервис"
        echo "  stop     - Остановить сервис"
        echo "  restart  - Перезапустить сервис"
        echo "  delete   - Удалить сервис из PM2"
        echo "  status   - Показать статус"
        echo "  logs     - Показать логи"
        echo "  monit    - Открыть мониторинг"
        echo "  save     - Сохранить список процессов"
        echo ""
        exit 1
        ;;
esac
