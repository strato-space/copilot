# План переноса генерации отчетов (Jira-style + Performer Weeks)

## 1. Цель и границы

**Цель:** перенести генерацию отчетов из automation в copilot с синхронным запуском по запросу из фронтенда (OperOps), выдавать ссылку на Google Drive сразу после завершения.

**В пределах:**
- Jira-style отчет (automation/reports/jira_style_report.js)
- Отчет по исполнителю (automation/reports/performer_weeks.js)

**Вне пределов:**
- Очереди BullMQ и фоновая генерация
- Телеграм-уведомления
- Перенос других отчетов или старых скриптов

## 2. Текущее состояние (automation)

### Jira-style
- Источник: automation/reports/jira_style_report.js
- Входные параметры:
  - project (id)
  - start_date, end_date
- Данные:
  - PROJECTS → PROJECT_GROUPS → CUSTOMERS
  - TASKS, WORK_HOURS, PERFORMERS
- Google Drive:
  - Фиксированный folder_id = 1Y8KaMhqi9HeiNUgiJtvYsdzOvMQvS8KD
- Особенности:
  - Генерация нового Google Sheets, формулы TotByTask/Tot, merge ячейки
  - Сортировка по исполнителю и проекту

### Performer Weeks
- Источник: automation/reports/performer_weeks.js
- Входные параметры:
  - performer (id)
  - start_date, end_date
- Данные:
  - WORK_HOURS, TASKS, PERFORMERS
- Google Drive:
  - folder_id берется из performer.drive_folder_id
- Особенности:
  - Разбиение по неделям и дням недели, формулы sum
  - Много стилей и merge ячеек

### Общие зависимости
- dayjs + плагины weekOfYear, isSameOrAfter, customParseFormat
- googleapis + google-spreadsheet
- lodash

## 3. Целевая архитектура в copilot

### 3.1 Backend (TypeScript, ES modules)

**Новый слой отчетов:**
- backend/src/services/reports/
  - jiraStyleReport.ts
  - performerWeeksReport.ts
  - types.ts (типизация входных параметров и результата)
  - googleDrive.ts (инициализация Service Account + helper-методы)

**Новые маршруты:**
- backend/src/api/routes/crm/reports.ts
  - POST /api/crm/reports/jira-style
  - POST /api/crm/reports/performer-weeks

**Маршрутизация:**
- подключить reports.ts в backend/src/api/routes/crm/index.ts

**Контракт ответа (единый для обоих отчетов):**
```
{ data: { url: string, documentId: string, sheetId: number }, error: null }
```

**Контракт ошибок:**
```
{ data: null, error: { message: string, code?: string } }
```

### 3.2 Frontend (OperOps)

**UI кнопки:**
- Добавить две кнопки на страницу OperOps (CRM):
  - Jira-style отчет
  - Отчет по исполнителю

**Модалки параметров:**
- Jira-style:
  - Project (Select с поиском по имени)
  - Date range (RangePicker)
- Доп. параметры не требуются
- Performer weeks:
  - Performer (Select)
  - Date range (RangePicker)

**После генерации:**
- показать модальное окно Отчет готов с кликабельной ссылкой
- автоматически открыть новую вкладку на Google Sheets

### 3.3 Синхронный поток
1. Пользователь заполняет форму и запускает отчет.
2. UI отправляет POST-запрос в backend.
3. Backend генерирует Google Sheet и возвращает ссылку.
4. UI показывает success-модалку и открывает ссылку.

## 4. Детали API

### 4.1 Jira-style
**POST /api/crm/reports/jira-style**

**Request:**
```
{
  projectId: string,
  startDate: string, // ISO
  endDate: string    // ISO
}
```

**Response:**
```
{
  data: {
    url: string,
    documentId: string,
    sheetId: number
  },
  error: null
}
```

### 4.2 Performer weeks
**POST /api/crm/reports/performer-weeks**

**Request:**
```
{
  performerId: string,
  startDate: string, // ISO
  endDate: string    // ISO
}
```

## 5. Хранилище и конфигурация

### 5.1 Google Service Account
- Хранить ключ файлом в репозитории copilot (скопировать из automation).
- Добавить файл в .gitignore.
- Путь до файла задавать в ENV: GOOGLE_SERVICE_ACCOUNT_PATH.

### 5.2 Папки Google Drive
- Jira-style: использовать фиксированный folder_id (как в automation).
- Performer weeks: брать folder_id из performer.drive_folder_id.

### 5.3 Аудит лог генераций
- Новая коллекция Mongo (например, automation_reports_log).
- Писать запись на успех и на ошибку:
  - reportType
  - params
  - createdAt
  - createdBy (user id + email/role)
  - status (success|error)
  - documentId, sheetId, url (если есть)
  - errorMessage (если есть)

## 6. План реализации

### Шаг 1. Подготовка бекенда
1. Создать helper для Google Drive (auth + create spreadsheet).
2. Переписать оба скрипта в TypeScript (без tg/queues).
3. Добавить сервисные функции генерации отчетов.
4. Добавить маршруты /api/crm/reports/*.
5. Добавить валидацию входных параметров.
6. Ограничить доступ: только ADMIN/SUPER_ADMIN.
7. Логировать все генерации в отдельную коллекцию (успех/ошибка).
8. Вернуть ссылку (url) и ID.

### Шаг 2. Подготовка фронтенда
1. Добавить кнопки в OperOps (страница CRM).
2. Реализовать 2 модалки формы (project select + performer select).
3. Создать API методы в request store.
4. Добавить загрузочный state + error handling.
5. После успеха: показать модалку + открыть ссылку.

### Шаг 3. Тестирование
1. Локальная проверка запросов с тестовыми датами.
2. Проверка корректности ссылок и доступа к Google Drive.
3. Проверка UI flow (модалки, автозапуск вкладки).

### Шаг 4. Документация
- Добавить параметры и env-переменные в docs/REPORTS_SETUP.md.

## 6.1 Статус выполнения
- [x] Backend: helper Google Drive (auth + create spreadsheet)
- [x] Backend: переписаны оба отчета (jira-style, performer weeks)
- [x] Backend: маршруты /api/crm/reports/*
- [x] Backend: валидация входных параметров
- [x] Backend: доступ ADMIN/SUPER_ADMIN
- [x] Backend: логирование генераций в отдельную коллекцию
- [x] Backend: возвращается url + documentId + sheetId
- [x] Frontend: кнопки в OperOps (верхняя панель)
- [x] Frontend: модалки параметров (project + performer)
- [x] Frontend: вызовы API + loader + обработка ошибок
- [x] Тесты: базовые unit-тесты для helpers отчетов
- [ ] Тестирование: локальная проверка генерации
- [x] Документация: env-переменные в docs/REPORTS_SETUP.md

## 7. Критерии приемки
- Оба отчета создаются из OperOps без очередей и без Telegram.
- Доступ ограничен ролями ADMIN/SUPER_ADMIN.
- Пользователь получает ссылку и отчет открывается в новой вкладке.
- Формы корректно валидируют параметры.
- Все генерации логируются в Mongo (успех и ошибка).
- Ошибки показываются пользователю, не приводят к падению UI.

## 8. Риски
- Генерация может занимать минуты → нужно UI loader и timeout.
- Ошибки Google API (неверные creds, нет прав на folder).
- Несоответствие схемы данных (customers, performers) в copilot DB.

## 9. Решения по уточнениям
1. Jira-style запускается по выбору проекта (Select с фильтром по имени).
2. Jira-style сохраняется в фиксированную папку Google Drive.
3. Google Service Account хранится файлом в copilot, файл в .gitignore.
4. Дополнительные поля не нужны.
5. Доступ к генерации: ADMIN/SUPER_ADMIN.
6. Кнопки в верхней панели OperOps.
7. История генераций пишется в отдельную коллекцию (параметры, ссылка, дата, пользователь).
8. При ошибке показывать кастомное сообщение, а детали писать в лог коллекцию.