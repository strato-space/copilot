const app = document.getElementById("app");

const storageKey = "ops_lang";
let currentLang = getInitialLang();
let currentSuggestOps = [];
let currentContext = null;
let lastApproveId = null;

const translations = {
  ru: {
    "lang.ru": "RU",
    "lang.en": "EN",
    "menu.more": "Меню",
    "menu.title": "Разделы",
    "suggest.tag": "Предложение",
    "nav.backlog": "Входящие",
    "nav.backlog.sub": "Очередь",
    "nav.week": "Неделя",
    "nav.week.sub": "План",
    "nav.today": "Сегодня",
    "nav.today.sub": "План дня",
    "nav.metrics": "Метрики",
    "nav.metrics.sub": "Сигналы",
    "nav.timeline": "Лента",
    "nav.timeline.sub": "Решения",
    "nav.month": "Месяц",
    "nav.month.sub": "Горизонт",
    "nav.memory": "Память",
    "nav.memory.sub": "Заметки",
    "nav.performer": "Профиль",
    "nav.performer.sub": "Исполнитель",
    "footer.source": "Источник данных: voicebot/downloads",
    "footer.approve": "Подтверждение через боковую панель",
    "footer.api": "API: /api/health",
    "ops.hub": "Операционный центр",
    "page.backlog.title": "Входящие",
    "page.backlog.desc": "Очередь intake, уточнения и готовые предложения патча.",
    "page.week.title": "План на неделю",
    "page.week.desc": "Балансировка по людям и проектам. Лимиты: <=7ч/день, <=2 проекта.",
    "page.today.title": "Сегодня",
    "page.today.desc": "План по проектам и людям с готовыми предложениями.",
    "page.metrics.title": "Метрики",
    "page.metrics.desc": "Еженедельные сигналы и автоматизация.",
    "page.timeline.title": "Лента",
    "page.timeline.desc": "История решений, патчей и автоматизаций.",
    "page.month.title": "Месяц",
    "page.month.desc": "Горизонт по неделям и фильтру проекта.",
    "page.memory.title": "Память",
    "page.memory.desc": "Заметки по проектам, людям и стратегии.",
    "page.performer.title": "Профиль исполнителя",
    "page.performer.desc": "Контекст, заметки и черновик агента.",
    "chip.ok": "OK",
    "chip.unsorted": "Без проекта",
    "chip.needs": "Нужно уточнить",
    "chip.not_ok": "НЕ ОК",
    "chip.missing_links": "Нет ссылок: {count}",
    "chip.no_owner": "Нет владельца: {count}",
    "chip.needs_estimate": "Нет оценки: {count}",
    "chip.load_issues": "Проблемы нагрузки: {count}",
    "section.new": "Новые",
    "section.needs_verify": "Нужно уточнить",
    "section.unsorted": "Без проекта",
    "section.project_candidates": "Кандидаты проектов",
    "section.forwardable": "Готовые ответы",
    "section.data_health": "Состояние данных",
    "section.today.by_project": "План по проектам",
    "section.today.by_people": "План по людям",
    "section.risk_signals": "Риски",
    "section.week.by_people": "По людям",
    "section.week.by_projects": "По проектам",
    "section.week.fix": "Исправить нагрузку",
    "section.metrics.automation": "Кандидаты автоматизации (топ 3)",
    "section.timeline.recent": "Последние события",
    "section.month.filters": "Фильтры",
    "section.memory.notes": "Заметки",
    "section.memory.history": "История",
    "section.performer.snapshot": "Срез профиля",
    "section.performer.notes": "Заметки",
    "section.performer.draft": "Черновик агента",
    "button.send_chat": "Отправить в чат",
    "button.open_overload": "Открыть список перегрузов",
    "button.fix_now": "Исправить сейчас",
    "button.open_details": "Детали",
    "button.create_epic": "Создать эпик",
    "button.add_note": "Добавить заметку",
    "button.accept": "Принять",
    "button.reject": "Отклонить",
    "btn.send": "Отправить",
    "btn.close": "Закрыть",
    "btn.approve": "Подтвердить",
    "btn.apply": "Применить",
    "btn.retry": "Повторить",
    "btn.back": "Назад",
    "status.ready": "готово к подтверждению",
    "status.approved": "подтверждено",
    "status.applied": "применено",
    "status.error": "ошибка",
    "status.none": "нет предложений",
    "notice.fallback": "API недоступен. Показаны резервные данные.",
    "notice.no_data": "Нет данных",
    "loading.title": "Загрузка",
    "loading.desc": "Получаем данные...",
    "error.title": "Ошибка данных",
    "error.desc": "Не удалось загрузить данные из API.",
    "api.checking": "API: проверка...",
    "api.offline": "API: недоступно",
    "api.ok": "API: ",
    "label.crm_snapshot": "CRM snapshot",
    "label.gate_issues": "Проблемы Gate",
    "label.missing_links": "Нет ссылок: {count}",
    "label.intent": "Понимание",
    "label.preview": "Результат",
    "label.no_draft": "Черновиков нет",
    "label.filters": "Фильтры",
    "source.voice": "голос",
    "source.chat": "чат",
    "source.doc": "док",
    "source.crm": "crm",
    "op.label.create": "СОЗД",
    "op.label.update": "ОБН",
    "op.label.assign": "НАЗН",
    "op.label.link": "ЛИНК",
    "op.label.status": "СТАТ",
    "op.label.due": "СРОК",
    "op.label.move": "ПЕРЕНОС",
    "op.label.split": "СПЛИТ",
    "op.label.epic": "ЭПИК",
    "op.label.risk": "РИСК",
    "op.label.note": "ЗАМ",
    "op.label.draft": "ЧЕРН",
    "op.create": "Создать задачу: {title}",
    "op.assign": "Назначить {task} на {assignee}",
    "op.link": "Прикрепить {url} к {task}",
    "op.status": "Перевести {task} в {status}",
    "op.due": "Установить срок для {task}",
    "op.move": "Переместить {task}",
    "op.split": "Разбить {task}",
    "op.epic": "Создать эпик: {title}",
    "op.note": "Добавить заметку: {text}",
    "op.draft": "Сохранить черновик: {text}",
    "op.default": "Предложение: {reason}",
    "suggest.title.patch": "Предложения (патч)",
    "suggest.title.week": "Предложения (неделя)",
    "suggest.title.today": "Предложения (сегодня)",
    "suggest.title.automation": "Предложения (автоматизация)",
    "suggest.title.followup": "Предложения (дальше)",
    "suggest.title.month": "Предложения (месяц)",
    "suggest.title.memory": "Предложения (память)",
    "suggest.title.profile": "Предложения (профиль)",
    "suggest.hint.patch": "Подтвердите, чтобы разблокировать применение. Применение пишется в Timeline.",
    "suggest.hint.week": "Применение только после подтверждения. Нагрузка должна быть <=7ч/день.",
    "suggest.hint.today": "Подтвердите патч, затем примените изменения.",
    "suggest.hint.automation": "Подтвердите, чтобы создать эпики и записать в Timeline.",
    "suggest.hint.followup": "Боковая панель фиксирует изменения в журнале.",
    "suggest.hint.month": "Месячный план сгруппирован по неделям. Применение после подтверждения.",
    "suggest.hint.memory": "Правки памяти требуют подтверждения владельцев.",
    "suggest.hint.profile": "Только владельцы могут принять черновики агента.",
    "agent.fab": "Агент",
    "agent.title": "Агент",
    "agent.subtitle": "Планы, патчи, метрики и ответы.",
    "agent.empty": "Пока нет сообщений.",
    "agent.commands.title": "Команды",
    "agent.cmd.today": "План на сегодня",
    "agent.cmd.week": "План на неделю",
    "agent.cmd.metrics": "Показать метрики",
    "agent.cmd.backlog": "Разобрать входящие",
    "agent.cmd.suggest": "Собрать патч",
    "agent.cmd.epic": "Создать эпик",
    "agent.input.placeholder": "Например: собери план на сегодня для RMS и предложи патч",
    "agent.intent.label": "Понимание",
    "agent.preview.label": "Результат",
    "agent.preview.value": "Подготовлены 2 предложения",
  },
  en: {
    "lang.ru": "RU",
    "lang.en": "EN",
    "menu.more": "Menu",
    "menu.title": "More",
    "suggest.tag": "Suggest",
    "nav.backlog": "Backlog",
    "nav.backlog.sub": "Intake",
    "nav.week": "Week",
    "nav.week.sub": "Plan",
    "nav.today": "Today",
    "nav.today.sub": "Daily plan",
    "nav.metrics": "Metrics",
    "nav.metrics.sub": "Signals",
    "nav.timeline": "Timeline",
    "nav.timeline.sub": "Decisions",
    "nav.month": "Month",
    "nav.month.sub": "Horizon",
    "nav.memory": "Memory",
    "nav.memory.sub": "Notes",
    "nav.performer": "Performer",
    "nav.performer.sub": "Profile",
    "footer.source": "Data source: voicebot/downloads",
    "footer.approve": "Approve via side panel",
    "footer.api": "API: /api/health",
    "ops.hub": "Ops Hub",
    "page.backlog.title": "Backlog",
    "page.backlog.desc": "Intake queue, clarifications, and patch-ready suggestions.",
    "page.week.title": "Week Plan",
    "page.week.desc": "Load balancing by people and projects. Limits: <=7h/day, <=2 projects.",
    "page.today.title": "Today",
    "page.today.desc": "Daily plan by projects and people with action-ready patches.",
    "page.metrics.title": "Metrics",
    "page.metrics.desc": "Weekly health checks and automation candidates.",
    "page.timeline.title": "Timeline",
    "page.timeline.desc": "Decision history, patch applications, and automation events.",
    "page.month.title": "Month",
    "page.month.desc": "Monthly horizon by weeks with project filter.",
    "page.memory.title": "Memory",
    "page.memory.desc": "Project, person, and strategy notes with audit history.",
    "page.performer.title": "Performer Profile",
    "page.performer.desc": "Performance context, notes, and agent drafts.",
    "chip.ok": "OK",
    "chip.unsorted": "Unsorted",
    "chip.needs": "Needs verify",
    "chip.not_ok": "NOT OK",
    "chip.missing_links": "Missing links: {count}",
    "chip.no_owner": "No owner: {count}",
    "chip.needs_estimate": "Needs estimate: {count}",
    "chip.load_issues": "Load issues: {count}",
    "section.new": "New",
    "section.needs_verify": "Needs verify",
    "section.unsorted": "Unsorted",
    "section.project_candidates": "Project candidates",
    "section.forwardable": "Forwardable answers",
    "section.data_health": "Data health",
    "section.today.by_project": "Today plan by projects",
    "section.today.by_people": "Today plan by people",
    "section.risk_signals": "Risk signals",
    "section.week.by_people": "By people",
    "section.week.by_projects": "By projects",
    "section.week.fix": "Fix load",
    "section.metrics.automation": "Automation candidates (top 3)",
    "section.timeline.recent": "Recent",
    "section.month.filters": "Filters",
    "section.memory.notes": "Notes",
    "section.memory.history": "History",
    "section.performer.snapshot": "Profile snapshot",
    "section.performer.notes": "Notes",
    "section.performer.draft": "Agent draft",
    "button.send_chat": "Send to chat",
    "button.open_overload": "Open overload list",
    "button.fix_now": "Fix now",
    "button.open_details": "Open details",
    "button.create_epic": "Create epic",
    "button.add_note": "Add note",
    "button.accept": "Accept",
    "button.reject": "Reject",
    "btn.send": "Send",
    "btn.close": "Close",
    "btn.approve": "Approve",
    "btn.apply": "Apply",
    "btn.retry": "Retry",
    "btn.back": "Back",
    "status.ready": "ready",
    "status.approved": "approved",
    "status.applied": "applied",
    "status.error": "error",
    "status.none": "no suggestions",
    "notice.fallback": "API unavailable. Showing fallback data.",
    "notice.no_data": "No data",
    "loading.title": "Loading",
    "loading.desc": "Fetching data...",
    "error.title": "Data error",
    "error.desc": "Unable to load data from API.",
    "api.checking": "API: checking...",
    "api.offline": "API: offline",
    "api.ok": "API: ",
    "label.crm_snapshot": "CRM snapshot",
    "label.gate_issues": "Gate issues",
    "label.missing_links": "Missing links: {count}",
    "label.intent": "Intent",
    "label.preview": "Result",
    "label.no_draft": "No draft",
    "label.filters": "Filters",
    "source.voice": "voice",
    "source.chat": "chat",
    "source.doc": "doc",
    "source.crm": "crm",
    "op.label.create": "CREATE",
    "op.label.update": "UPDATE",
    "op.label.assign": "ASSIGN",
    "op.label.link": "LINK",
    "op.label.status": "STATUS",
    "op.label.due": "DUE",
    "op.label.move": "MOVE",
    "op.label.split": "SPLIT",
    "op.label.epic": "EPIC",
    "op.label.risk": "RISK",
    "op.label.note": "NOTE",
    "op.label.draft": "DRAFT",
    "op.create": "Create task: {title}",
    "op.assign": "Assign {task} to {assignee}",
    "op.link": "Link {url} to {task}",
    "op.status": "Move {task} to {status}",
    "op.due": "Set due date for {task}",
    "op.move": "Move {task}",
    "op.split": "Split {task}",
    "op.epic": "Create epic: {title}",
    "op.note": "Add note: {text}",
    "op.draft": "Save draft: {text}",
    "op.default": "Suggestion: {reason}",
    "suggest.title.patch": "Suggest (Patch)",
    "suggest.title.week": "Suggest (Week)",
    "suggest.title.today": "Suggest (Today)",
    "suggest.title.automation": "Suggest (Automation)",
    "suggest.title.followup": "Suggest (Follow-up)",
    "suggest.title.month": "Suggest (Month)",
    "suggest.title.memory": "Suggest (Memory)",
    "suggest.title.profile": "Suggest (Profile)",
    "suggest.hint.patch": "Approve to unlock Apply. Apply will be logged in Timeline.",
    "suggest.hint.week": "Apply only after approval. Load must drop to <=7h/day.",
    "suggest.hint.today": "Approve the patch, then Apply writes changes.",
    "suggest.hint.automation": "Approve to queue epics and log to Timeline.",
    "suggest.hint.followup": "Side panel keeps changes consistent with audit log.",
    "suggest.hint.month": "Month plan is grouped by weeks. Apply only after approval.",
    "suggest.hint.memory": "Memory edits require approval by owners.",
    "suggest.hint.profile": "Only owners can accept agent drafts.",
    "agent.fab": "Agent",
    "agent.title": "Agent",
    "agent.subtitle": "Plans, patches, metrics, and answers.",
    "agent.empty": "No messages yet.",
    "agent.commands.title": "Commands",
    "agent.cmd.today": "Today plan",
    "agent.cmd.week": "Week plan",
    "agent.cmd.metrics": "Show metrics",
    "agent.cmd.backlog": "Triage backlog",
    "agent.cmd.suggest": "Build patch",
    "agent.cmd.epic": "Create epic",
    "agent.input.placeholder": "Example: build today plan for RMS and suggest a patch",
    "agent.intent.label": "Intent preview",
    "agent.preview.label": "Result preview",
    "agent.preview.value": "2 suggestions prepared",
  },
};

const fallbackData = {
  ru: {
    backlog: {
      items: [
        {
          inbox_id: "inbox-101",
          source_type: "voice",
          summary: "RMS: обновить демо-флоу с владельцем",
          status: "new",
          project_guess: "RMS",
          owner_guess: "Masha",
        },
      ],
      needs_verify: [
        {
          inbox_id: "inbox-201",
          source_type: "chat",
          summary: "Проект? Обновление маркетинг-доски",
          status: "needs_verify",
        },
      ],
      unsorted: [
        {
          inbox_id: "inbox-301",
          source_type: "voice",
          summary: "Без проекта: Alpha doc clean-up",
          status: "unsorted",
        },
      ],
      project_candidates: ["Beta launch", "Gamma refactor"],
      forwardable: ["Aurora: статус и следующий шаг в CRM"],
      suggest_ops: [
        {
          op_id: "op-001",
          type: "create",
          payload: { title: "RMS demo script" },
          reason: "intake: voice summary",
        },
      ],
    },
    today: {
      plan_by_project: [
        { label: "RMS", details: "demo flow -> script draft -> link in CRM" },
        { label: "Aurora", details: "landing QA -> fix checklist -> update status" },
      ],
      plan_by_people: [
        { label: "Masha", details: "RMS demo script, Aurora QA checklist" },
        { label: "Dasha", details: "Unsorted triage + CRM links" },
      ],
      risk_signals: ["RMS demo task missing artifact link"],
      suggest_ops: [
        {
          op_id: "op-002",
          type: "link",
          payload: { task_id: "RMS-88", url: "https://figma.com/file/abc" },
          reason: "missing link",
        },
      ],
    },
    week: {
      by_people: [
        { label: "Masha", details: "Mon RMS (3h), Tue Aurora (2h), Wed RMS (2h)" },
        { label: "Andre", details: "Mon Aurora (4h), Tue Aurora (4h) overload" },
      ],
      by_projects: [
        { label: "RMS", details: "demo flow, QA, asset handoff" },
        { label: "Aurora", details: "landing fix, CRM links, QA checklist" },
      ],
      load_issues: ["Andre exceeds 7h/day"],
      suggest_ops: [
        {
          op_id: "op-003",
          type: "assign",
          payload: { task_id: "AUR-312", assignee: "Dasha" },
          reason: "load balance",
        },
      ],
    },
    metrics: {
      metrics: [
        { label: "Execution rate", value: "78%", note: "Up 6% vs last week" },
        { label: "Unsorted", value: "14", note: "+9 in 5 days" },
      ],
      not_ok_signals: ["Unsorted growth +9"],
      automation_candidates: [
        { label: "Plan status answers", count: 12, pain: "manual replies" },
      ],
      suggest_ops: [
        {
          op_id: "op-101",
          type: "epic",
          payload: { title: "Auto status answers" },
          reason: "top automation candidate",
        },
      ],
    },
    timeline: {
      events: [
        {
          event_id: "evt-001",
          date: "2026-01-19T09:10:00Z",
          event_type: "decision",
          summary: "RMS demo scope locked",
          refs: ["RMS"],
        },
      ],
      filters: ["project", "assignee", "event_type"],
    },
    month: {
      weeks: [
        { label: "Week 1", items: ["RMS demo assets + QA", "Owner: Masha"] },
        { label: "Week 2", items: ["RMS launch checklist", "Owner: Andre"] },
      ],
      filters: ["month", "project", "assignee"],
      suggest_ops: [
        {
          op_id: "op-201",
          type: "due",
          payload: { task_id: "RMS-88", due: "2026-02-01" },
          reason: "missing due date",
        },
      ],
    },
    memory: {
      notes: [
        {
          note_id: "note-001",
          type: "project_note",
          text: "RMS demo output must include link + 1 summary",
          author: "Nikita",
          created_at: "2026-01-18T10:00:00Z",
        },
      ],
      history: ["2026-01-19: updated RMS delivery rule"],
      suggest_ops: [
        {
          op_id: "op-301",
          type: "note",
          payload: { text: "RMS needs demo link" },
          reason: "memory draft",
        },
      ],
    },
    performer: {
      profile: {
        person_id: "masha",
        notes: [
          {
            note_id: "note-101",
            type: "person_note",
            text: "Prefers early feedback on demo scripts",
            author: "Mark",
            created_at: "2026-01-17T09:00:00Z",
          },
        ],
        agent_drafts: ["QA artifacts need faster linking to CRM."],
        history: ["2026-01-18: added person note"],
      },
      suggest_ops: [
        {
          op_id: "op-401",
          type: "draft",
          payload: { text: "Add note: prioritize CRM links" },
          reason: "agent draft",
        },
      ],
    },
  },
  en: {
    backlog: {
      items: [
        {
          inbox_id: "inbox-101",
          source_type: "voice",
          summary: "RMS demo flow update with owner",
          status: "new",
          project_guess: "RMS",
          owner_guess: "Masha",
        },
      ],
      needs_verify: [
        {
          inbox_id: "inbox-201",
          source_type: "chat",
          summary: "Project? Marketing board revamp",
          status: "needs_verify",
        },
      ],
      unsorted: [
        {
          inbox_id: "inbox-301",
          source_type: "voice",
          summary: "Unknown project: Alpha doc clean-up",
          status: "unsorted",
        },
      ],
      project_candidates: ["Beta launch", "Gamma refactor"],
      forwardable: ["Aurora status: link + next step in CRM"],
      suggest_ops: [
        {
          op_id: "op-001",
          type: "create",
          payload: { title: "RMS demo script" },
          reason: "intake: voice summary",
        },
      ],
    },
    today: {
      plan_by_project: [
        { label: "RMS", details: "demo flow -> script draft -> link in CRM" },
        { label: "Aurora", details: "landing QA -> fix checklist -> update status" },
      ],
      plan_by_people: [
        { label: "Masha", details: "RMS demo script, Aurora QA checklist" },
        { label: "Dasha", details: "Unsorted triage + CRM links" },
      ],
      risk_signals: ["RMS demo task missing artifact link"],
      suggest_ops: [
        {
          op_id: "op-002",
          type: "link",
          payload: { task_id: "RMS-88", url: "https://figma.com/file/abc" },
          reason: "missing link",
        },
      ],
    },
    week: {
      by_people: [
        { label: "Masha", details: "Mon RMS (3h), Tue Aurora (2h), Wed RMS (2h)" },
        { label: "Andre", details: "Mon Aurora (4h), Tue Aurora (4h) overload" },
      ],
      by_projects: [
        { label: "RMS", details: "demo flow, QA, asset handoff" },
        { label: "Aurora", details: "landing fix, CRM links, QA checklist" },
      ],
      load_issues: ["Andre exceeds 7h/day"],
      suggest_ops: [
        {
          op_id: "op-003",
          type: "assign",
          payload: { task_id: "AUR-312", assignee: "Dasha" },
          reason: "load balance",
        },
      ],
    },
    metrics: {
      metrics: [
        { label: "Execution rate", value: "78%", note: "Up 6% vs last week" },
        { label: "Unsorted", value: "14", note: "+9 in 5 days" },
      ],
      not_ok_signals: ["Unsorted growth +9"],
      automation_candidates: [
        { label: "Plan status answers", count: 12, pain: "manual replies" },
      ],
      suggest_ops: [
        {
          op_id: "op-101",
          type: "epic",
          payload: { title: "Auto status answers" },
          reason: "top automation candidate",
        },
      ],
    },
    timeline: {
      events: [
        {
          event_id: "evt-001",
          date: "2026-01-19T09:10:00Z",
          event_type: "decision",
          summary: "RMS demo scope locked",
          refs: ["RMS"],
        },
      ],
      filters: ["project", "assignee", "event_type"],
    },
    month: {
      weeks: [
        { label: "Week 1", items: ["RMS demo assets + QA", "Owner: Masha"] },
        { label: "Week 2", items: ["RMS launch checklist", "Owner: Andre"] },
      ],
      filters: ["month", "project", "assignee"],
      suggest_ops: [
        {
          op_id: "op-201",
          type: "due",
          payload: { task_id: "RMS-88", due: "2026-02-01" },
          reason: "missing due date",
        },
      ],
    },
    memory: {
      notes: [
        {
          note_id: "note-001",
          type: "project_note",
          text: "RMS demo output must include link + 1 summary",
          author: "Nikita",
          created_at: "2026-01-18T10:00:00Z",
        },
      ],
      history: ["2026-01-19: updated RMS delivery rule"],
      suggest_ops: [
        {
          op_id: "op-301",
          type: "note",
          payload: { text: "RMS needs demo link" },
          reason: "memory draft",
        },
      ],
    },
    performer: {
      profile: {
        person_id: "masha",
        notes: [
          {
            note_id: "note-101",
            type: "person_note",
            text: "Prefers early feedback on demo scripts",
            author: "Mark",
            created_at: "2026-01-17T09:00:00Z",
          },
        ],
        agent_drafts: ["QA artifacts need faster linking to CRM."],
        history: ["2026-01-18: added person note"],
      },
      suggest_ops: [
        {
          op_id: "op-401",
          type: "draft",
          payload: { text: "Add note: prioritize CRM links" },
          reason: "agent draft",
        },
      ],
    },
  },
};

const opsTabs = [
  { path: "/backlog", labelKey: "nav.backlog", subKey: "nav.backlog.sub" },
  { path: "/week", labelKey: "nav.week", subKey: "nav.week.sub" },
  { path: "/today", labelKey: "nav.today", subKey: "nav.today.sub" },
  { path: "/metrics", labelKey: "nav.metrics", subKey: "nav.metrics.sub" },
  { path: "/timeline", labelKey: "nav.timeline", subKey: "nav.timeline.sub" },
];

const routes = {
  "/": { key: "backlog", titleKey: "page.backlog.title", load: () => fetchOps("/api/ops/backlog") },
  "/backlog": { key: "backlog", titleKey: "page.backlog.title", load: () => fetchOps("/api/ops/backlog") },
  "/week": { key: "week", titleKey: "page.week.title", load: () => fetchOps("/api/ops/week") },
  "/today": { key: "today", titleKey: "page.today.title", load: () => fetchOps("/api/ops/today") },
  "/metrics": { key: "metrics", titleKey: "page.metrics.title", load: () => fetchOps("/api/ops/metrics") },
  "/timeline": { key: "timeline", titleKey: "page.timeline.title", load: () => fetchOps("/api/ops/timeline") },
  "/month": { key: "month", titleKey: "page.month.title", load: () => fetchOps("/api/ops/month") },
  "/memory": { key: "memory", titleKey: "page.memory.title", load: () => fetchOps("/api/ops/memory") },
  "/performer": { key: "performer", titleKey: "page.performer.title", load: () => fetchOps("/api/ops/performer/masha") },
};

function getInitialLang() {
  const stored = localStorage.getItem(storageKey);
  if (stored === "en" || stored === "ru") {
    return stored;
  }
  return "ru";
}

function t(key, values) {
  const dictionary = translations[currentLang] || translations.en;
  let template = dictionary[key] || translations.en[key] || key;
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, name) => values[name] || "");
}

function setTitle(key) {
  document.title = `${t(key)} - Ops Planning Copilot`;
}

function listItems(items, className = "item-list") {
  return `<ul class="${className}">${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function renderList(items, emptyKey) {
  if (!items || items.length === 0) {
    return listItems([t(emptyKey || "notice.no_data")]);
  }
  return listItems(items);
}

function chip(label, tone = "neutral") {
  return `<span class="chip chip--${tone}">${label}</span>`;
}

function opLabel(opType) {
  return t(`op.label.${opType}`) || opType.toUpperCase();
}

function formatOpText(op) {
  const payload = op.payload || {};
  const task = payload.task_id || t("notice.no_data");
  const assignee = payload.assignee || t("notice.no_data");
  const title = payload.title || t("notice.no_data");
  const text = payload.text || t("notice.no_data");
  const status = payload.status || t("notice.no_data");
  const url = payload.url || t("notice.no_data");

  switch (op.type) {
    case "create":
      return t("op.create", { title });
    case "assign":
      return t("op.assign", { task, assignee });
    case "link":
      return t("op.link", { task, url });
    case "status":
      return t("op.status", { task, status });
    case "due":
      return t("op.due", { task });
    case "move":
      return t("op.move", { task });
    case "split":
      return t("op.split", { task });
    case "epic":
      return t("op.epic", { title });
    case "note":
      return t("op.note", { text });
    case "draft":
      return t("op.draft", { text });
    default:
      return t("op.default", { reason: op.reason || "" });
  }
}

function buildSuggestItems(ops) {
  if (!ops || ops.length === 0) {
    return [
      `<span class=\"tag\">${t("status.none")}</span><span>${t("notice.no_data")}</span>`,
    ];
  }
  return ops.map((op) => {
    const label = opLabel(op.type || "update");
    return `<span class=\"tag tag--${op.type || "status"}\">${label}</span><span>${formatOpText(op)}</span>`;
  });
}

function pageHeader({ eyebrow, titleKey, descriptionKey, chips = [] }) {
  return `
    <section class="page-header">
      <div class="page-title">
        <div class="eyebrow">${eyebrow}</div>
        <h1>${t(titleKey)}</h1>
        <p>${t(descriptionKey)}</p>
      </div>
      <div class="header-chips">
        ${chips.map((item) => chip(item.label, item.tone)).join("")}
      </div>
    </section>
  `;
}

function opsSubnav(activePath) {
  return `
    <div class="subnav">
      ${opsTabs
        .map(
          (tab) => `
        <a href="${tab.path}" data-link class="${tab.path === activePath ? "active" : ""}">
          <span class="nav-title">${t(tab.labelKey)}</span>
          <span class="nav-sub">${t(tab.subKey)}</span>
        </a>
      `
        )
        .join("")}
    </div>
  `;
}

function noticeBanner(message) {
  return `<div class="notice">${message}</div>`;
}

function suggestPanel({ titleKey, statusKey, ops, hintKey }) {
  const items = buildSuggestItems(ops);
  return `
    <aside class="panel side-panel" data-panel>
      <div class="panel-head">
        <div>
          <div class="panel-title">${t(titleKey)}</div>
          <div class="panel-status">${t(statusKey)}</div>
        </div>
        <span class="tag tag--soft">${t("suggest.tag")}</span>
      </div>
      <ul class="suggest-list">
        ${items
          .map(
            (item) => `
          <li>
            ${item}
          </li>
        `
          )
          .join("")}
      </ul>
      <div class="panel-actions">
        <button class="btn btn--ghost" type="button" data-action="approve">${t("btn.approve")}</button>
        <button class="btn btn--accent" type="button" data-action="apply" disabled>${t("btn.apply")}</button>
      </div>
      <p class="panel-hint">${t(hintKey)}</p>
    </aside>
  `;
}

function apiStatusLine() {
  return `
    <div class="status-line" id="api-status">
      <span class="dot"></span>
      <span>${t("api.checking")}</span>
    </div>
  `;
}

function formatSnapshot(snapshot) {
  if (!snapshot) return null;
  const filename = snapshot.filename || "";
  const date = snapshot.date || "";
  if (date && filename) return `${date} — ${filename}`;
  if (date) return date;
  if (filename) return filename;
  return null;
}

function updateFooterSnapshot(snapshot) {
  const el = document.getElementById("footerSnapshot");
  if (!el) return;
  const text = formatSnapshot(snapshot);
  if (!text) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  el.textContent = text;
  el.hidden = false;
}

function getInitials(name) {
  if (!name) return "--";
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0].toUpperCase());
  return initials.join("") || "--";
}

function renderBacklogEntry(item) {
  const priority = item.priority || "P?";
  const owner = item.owner_guess || "--";
  const initials = getInitials(owner);
  const source = t(`source.${item.source_type}`);
  return `
    <div class="item-row">
      <div class="item-main">
        <span class="tag">${source}</span>
        <span>${item.summary}</span>
      </div>
      <div class="item-meta">
        <span class="priority-pill">${priority}</span>
        <span class="avatar" aria-label="${owner}">${initials}</span>
      </div>
    </div>
  `;
}

function renderBacklog(data, options = {}) {
  const snapshotText = formatSnapshot(data.snapshot) || "voicebot/downloads";
  return `
    ${options.notice ? noticeBanner(options.notice) : ""}
    ${pageHeader({
      eyebrow: t("ops.hub"),
      titleKey: "page.backlog.title",
      descriptionKey: "page.backlog.desc",
      chips: [
        { label: t("chip.ok"), tone: "ok" },
        { label: `${t("chip.unsorted")} ${data.unsorted.length}`, tone: "warn" },
        { label: `${t("chip.needs")} ${data.needs_verify.length}`, tone: "risk" },
      ],
    })}
    ${opsSubnav("/backlog")}
    <div class="page-grid">
      <div class="main-column">
        <div class="panel-grid">
          <article class="panel">
            <div class="panel-title">${t("section.new")}</div>
            ${renderList(data.items.map(renderBacklogEntry))}
          </article>
          <article class="panel">
            <div class="panel-title">${t("section.needs_verify")}</div>
            ${renderList(data.needs_verify.map(renderBacklogEntry))}
          </article>
          <article class="panel">
            <div class="panel-title">${t("section.unsorted")}</div>
            ${renderList(data.unsorted.map(renderBacklogEntry))}
          </article>
          <article class="panel">
            <div class="panel-title">${t("section.project_candidates")}</div>
            ${renderList(data.project_candidates)}
          </article>
        </div>
        <div class="panel-grid">
          <article class="panel">
            <div class="panel-title">${t("section.forwardable")}</div>
            ${renderList(data.forwardable)}
            <div class="panel-actions">
              <button class="btn btn--ghost" type="button">${t("button.send_chat")}</button>
            </div>
          </article>
          <article class="panel">
            <div class="panel-title">${t("section.data_health")}</div>
            <div class="data-row">
              <span>${t("label.crm_snapshot")}</span>
              <span class="data-value">${snapshotText}</span>
            </div>
            ${apiStatusLine()}
            <div class="data-row">
              <span>${t("label.gate_issues")}</span>
              <span class="data-value">${t("label.missing_links", { count: 4 })}</span>
            </div>
          </article>
        </div>
      </div>
      ${suggestPanel({
        titleKey: "suggest.title.patch",
        statusKey: "status.ready",
        ops: data.suggest_ops,
        hintKey: "suggest.hint.patch",
      })}
    </div>
  `;
}

function renderWeek(data, options = {}) {
  return `
    ${options.notice ? noticeBanner(options.notice) : ""}
    ${pageHeader({
      eyebrow: t("ops.hub"),
      titleKey: "page.week.title",
      descriptionKey: "page.week.desc",
      chips: [
        { label: t("chip.ok"), tone: "ok" },
        { label: t("chip.load_issues", { count: data.load_issues.length }), tone: "warn" },
        { label: t("chip.needs_estimate", { count: 5 }), tone: "risk" },
      ],
    })}
    ${opsSubnav("/week")}
    <div class="page-grid">
      <div class="main-column">
        <div class="week-board">
          <article class="panel">
            <div class="panel-title">${t("section.week.by_people")}</div>
            ${renderList(data.by_people.map((line) => `${line.label}: ${line.details}`))}
          </article>
          <article class="panel">
            <div class="panel-title">${t("section.week.by_projects")}</div>
            ${renderList(data.by_projects.map((line) => `${line.label}: ${line.details}`))}
          </article>
        </div>
        <article class="panel">
          <div class="panel-title">${t("section.week.fix")}</div>
          ${renderList(data.load_issues)}
          <div class="panel-actions">
            <button class="btn btn--ghost" type="button">${t("button.open_overload")}</button>
          </div>
        </article>
      </div>
      ${suggestPanel({
        titleKey: "suggest.title.week",
        statusKey: "status.ready",
        ops: data.suggest_ops,
        hintKey: "suggest.hint.week",
      })}
    </div>
  `;
}

function renderToday(data, options = {}) {
  return `
    ${options.notice ? noticeBanner(options.notice) : ""}
    ${pageHeader({
      eyebrow: t("ops.hub"),
      titleKey: "page.today.title",
      descriptionKey: "page.today.desc",
      chips: [
        { label: t("chip.not_ok"), tone: "risk" },
        { label: t("chip.missing_links", { count: 3 }), tone: "warn" },
        { label: t("chip.no_owner", { count: 1 }), tone: "warn" },
      ],
    })}
    ${opsSubnav("/today")}
    <div class="page-grid">
      <div class="main-column">
        <div class="panel-grid">
          <article class="panel">
            <div class="panel-title">${t("section.today.by_project")}</div>
            ${renderList(data.plan_by_project.map((line) => `${line.label}: ${line.details}`))}
          </article>
          <article class="panel">
            <div class="panel-title">${t("section.today.by_people")}</div>
            ${renderList(data.plan_by_people.map((line) => `${line.label}: ${line.details}`))}
          </article>
        </div>
        <article class="panel">
          <div class="panel-title">${t("section.risk_signals")}</div>
          ${renderList(data.risk_signals)}
          <div class="panel-actions">
            <button class="btn btn--ghost" type="button">${t("button.fix_now")}</button>
          </div>
        </article>
      </div>
      ${suggestPanel({
        titleKey: "suggest.title.today",
        statusKey: "status.ready",
        ops: data.suggest_ops,
        hintKey: "suggest.hint.today",
      })}
    </div>
  `;
}

function renderMetrics(data, options = {}) {
  return `
    ${options.notice ? noticeBanner(options.notice) : ""}
    ${pageHeader({
      eyebrow: t("ops.hub"),
      titleKey: "page.metrics.title",
      descriptionKey: "page.metrics.desc",
      chips: [
        { label: "Execution 78%", tone: "ok" },
        { label: "WIP stuck 4", tone: "warn" },
        { label: "Unsorted +9", tone: "risk" },
      ],
    })}
    ${opsSubnav("/metrics")}
    <div class="page-grid">
      <div class="main-column">
        <div class="metric-grid">
          ${data.metrics
            .map(
              (metric) => `
            <article class="panel">
              <div class="panel-title">${metric.label}</div>
              <div class="metric-value">${metric.value}</div>
              <div class="metric-note">${metric.note || ""}</div>
            </article>
          `
            )
            .join("")}
        </div>
        <article class="panel">
          <div class="panel-title">${t("section.metrics.automation")}</div>
          ${renderList(
            data.automation_candidates.map(
              (item) => `${item.label} (${item.count}x) -> ${item.pain}`
            )
          )}
          <div class="panel-actions">
            <button class="btn btn--ghost" type="button">${t("button.open_details")}</button>
            <button class="btn btn--accent" type="button">${t("button.create_epic")}</button>
          </div>
        </article>
      </div>
      ${suggestPanel({
        titleKey: "suggest.title.automation",
        statusKey: "status.ready",
        ops: data.suggest_ops,
        hintKey: "suggest.hint.automation",
      })}
    </div>
  `;
}

function renderTimeline(data, options = {}) {
  return `
    ${options.notice ? noticeBanner(options.notice) : ""}
    ${pageHeader({
      eyebrow: t("ops.hub"),
      titleKey: "page.timeline.title",
      descriptionKey: "page.timeline.desc",
      chips: [
        { label: `events ${data.events.length}`, tone: "neutral" },
        { label: "patch_applied 3", tone: "ok" },
      ],
    })}
    ${opsSubnav("/timeline")}
    <div class="page-grid">
      <div class="main-column">
        <article class="panel">
          <div class="panel-title">${t("section.timeline.recent")}</div>
          ${renderList(
            data.events.map(
              (event) => `${event.date} ${event.event_type}: ${event.summary}`
            ),
            "notice.no_data"
          )}
        </article>
      </div>
      ${suggestPanel({
        titleKey: "suggest.title.followup",
        statusKey: "status.ready",
        ops: [
          {
            op_id: "op-risk-1",
            type: "risk",
            payload: { text: "Resolve missing link for Aurora QA" },
            reason: "risk follow-up",
          },
          {
            op_id: "op-note-1",
            type: "note",
            payload: { text: "Add decision note to RMS memory" },
            reason: "decision follow-up",
          },
        ],
        hintKey: "suggest.hint.followup",
      })}
    </div>
  `;
}

function renderMonth(data, options = {}) {
  return `
    ${options.notice ? noticeBanner(options.notice) : ""}
    ${pageHeader({
      eyebrow: t("page.month.title"),
      titleKey: "page.month.title",
      descriptionKey: "page.month.desc",
      chips: [
        { label: "Project: RMS", tone: "neutral" },
        { label: "auto-generated", tone: "warn" },
      ],
    })}
    <div class="page-grid">
      <div class="main-column">
        <article class="panel">
          <div class="panel-title">${t("section.month.filters")}</div>
          <div class="filter-row">
            <button class="btn btn--ghost" type="button">Month: Oct 2026</button>
            <button class="btn btn--ghost" type="button">Project: RMS</button>
            <button class="btn btn--ghost" type="button">Assignee: All</button>
          </div>
        </article>
        <div class="panel-grid">
          ${data.weeks
            .map(
              (week) => `
            <article class="panel">
              <div class="panel-title">${week.label}</div>
              ${renderList(week.items)}
            </article>
          `
            )
            .join("")}
        </div>
      </div>
      ${suggestPanel({
        titleKey: "suggest.title.month",
        statusKey: "status.ready",
        ops: data.suggest_ops,
        hintKey: "suggest.hint.month",
      })}
    </div>
  `;
}

function renderMemory(data, options = {}) {
  return `
    ${options.notice ? noticeBanner(options.notice) : ""}
    ${pageHeader({
      eyebrow: t("page.memory.title"),
      titleKey: "page.memory.title",
      descriptionKey: "page.memory.desc",
      chips: [
        { label: "editors: you + Nikita", tone: "neutral" },
        { label: "history on", tone: "ok" },
      ],
    })}
    <div class="page-grid">
      <div class="main-column">
        <article class="panel">
          <div class="panel-title">${t("section.month.filters")}</div>
          <div class="filter-row">
            <button class="btn btn--ghost" type="button">Type: project_note</button>
            <button class="btn btn--ghost" type="button">Project: RMS</button>
            <button class="btn btn--ghost" type="button">Owner: All</button>
          </div>
        </article>
        <article class="panel">
          <div class="panel-title">${t("section.memory.notes")}</div>
          ${renderList(data.notes.map((note) => `${note.type}: ${note.text}`))}
          <div class="panel-actions">
            <button class="btn btn--accent" type="button">${t("button.add_note")}</button>
          </div>
        </article>
        <article class="panel">
          <div class="panel-title">${t("section.memory.history")}</div>
          ${renderList(data.history)}
        </article>
      </div>
      ${suggestPanel({
        titleKey: "suggest.title.memory",
        statusKey: "status.ready",
        ops: data.suggest_ops,
        hintKey: "suggest.hint.memory",
      })}
    </div>
  `;
}

function renderPerformer(data, options = {}) {
  const profile = data.profile;
  return `
    ${options.notice ? noticeBanner(options.notice) : ""}
    ${pageHeader({
      eyebrow: t("page.performer.title"),
      titleKey: "page.performer.title",
      descriptionKey: "page.performer.desc",
      chips: [
        { label: `view: ${profile.person_id}`, tone: "neutral" },
        { label: "agent draft pending", tone: "warn" },
      ],
    })}
    <div class="page-grid">
      <div class="main-column">
        <article class="panel">
          <div class="panel-title">${t("section.performer.snapshot")}</div>
          <div class="stat-grid">
            <div>
              <div class="meta-label">Projects</div>
              <div class="metric-value">2</div>
            </div>
            <div>
              <div class="meta-label">Done last week</div>
              <div class="metric-value">12</div>
            </div>
            <div>
              <div class="meta-label">Review lead time</div>
              <div class="metric-value">1.2d</div>
            </div>
          </div>
        </article>
        <article class="panel">
          <div class="panel-title">${t("section.performer.notes")}</div>
          ${renderList(profile.notes.map((note) => note.text))}
        </article>
        <article class="panel">
          <div class="panel-title">${t("section.performer.draft")}</div>
          <p class="panel-sub">${t("agent.subtitle")}</p>
          <div class="draft-box">
            ${profile.agent_drafts.length ? profile.agent_drafts[0] : t("label.no_draft")}
          </div>
          <div class="panel-actions">
            <button class="btn btn--accent" type="button">${t("button.accept")}</button>
            <button class="btn btn--ghost" type="button">${t("button.reject")}</button>
          </div>
        </article>
      </div>
      ${suggestPanel({
        titleKey: "suggest.title.profile",
        statusKey: "status.ready",
        ops: data.suggest_ops,
        hintKey: "suggest.hint.profile",
      })}
    </div>
  `;
}

function renderLoading(titleKey) {
  return `
    <section class="panel loading-state">
      <div class="panel-title">${t(titleKey)}</div>
      <p>${t("loading.desc")}</p>
    </section>
  `;
}

function renderError() {
  return `
    <section class="panel empty-state">
      <div class="panel-title">${t("error.title")}</div>
      <p>${t("error.desc")}</p>
      <div class="panel-actions">
        <button class="btn btn--accent" type="button" data-action="retry">${t("btn.retry")}</button>
      </div>
    </section>
  `;
}

async function fetchOps(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function applyTranslations() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      el.textContent = t(key);
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) {
      el.setAttribute("placeholder", t(key));
    }
  });
}

function setActiveLinks(path) {
  document.querySelectorAll("a[data-link]").forEach((link) => {
    const isActive = link.getAttribute("href") === path;
    link.classList.toggle("active", isActive);
  });
}

async function loadApiStatus() {
  const statusEl = document.getElementById("api-status");
  if (!statusEl) return;

  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("API error");
    const data = await response.json();
    statusEl.innerHTML = `
      <span class="dot dot--ok"></span>
      <span>${t("api.ok")}${data.status}</span>
    `;
  } catch (error) {
    statusEl.innerHTML = `
      <span class="dot dot--error"></span>
      <span>${t("api.offline")}</span>
    `;
  }
}

function bindPanelActions() {
  document.querySelectorAll("[data-action='approve']").forEach((button) => {
    button.addEventListener("click", async () => {
      const panel = button.closest("[data-panel]");
      if (!panel) return;
      const status = panel.querySelector(".panel-status");
      const applyButton = panel.querySelector("[data-action='apply']");
      try {
        const response = await postJson("/api/ops/approve", {
          ops: currentSuggestOps,
          context: currentContext,
        });
        lastApproveId = response.approve_id;
        panel.classList.add("is-approved");
        if (status) {
          status.textContent = t("status.approved");
        }
        if (applyButton) {
          applyButton.removeAttribute("disabled");
        }
      } catch (error) {
        if (status) {
          status.textContent = t("status.error");
        }
        if (applyButton) {
          applyButton.setAttribute("disabled", "true");
        }
      }
    });
  });

  document.querySelectorAll("[data-action='apply']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.hasAttribute("disabled")) return;
      const panel = button.closest("[data-panel]");
      if (!panel) return;
      const status = panel.querySelector(".panel-status");
      try {
        const response = await postJson("/api/ops/apply", {
          approve_id: lastApproveId,
        });
        if (status) {
          status.textContent = t("status.applied");
        }
      } catch (error) {
        if (status) {
          status.textContent = t("status.error");
        }
      }
    });
  });
}

function bindGlobalActions() {
  document.querySelectorAll("[data-action='retry']").forEach((button) => {
    button.addEventListener("click", () => {
      render(window.location.pathname);
    });
  });
}

function bindBurgerMenu() {
  const burgerToggle = document.getElementById("burgerToggle");
  const burgerPanel = document.getElementById("burgerPanel");
  const burgerBackdrop = document.getElementById("burgerBackdrop");
  const burgerClose = document.getElementById("burgerClose");

  if (!burgerToggle || !burgerPanel || !burgerBackdrop || !burgerClose) return;

  const closeMenu = () => {
    burgerPanel.classList.remove("is-open");
    burgerBackdrop.hidden = true;
    burgerPanel.setAttribute("aria-hidden", "true");
    burgerToggle.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    burgerPanel.classList.add("is-open");
    burgerBackdrop.hidden = false;
    burgerPanel.setAttribute("aria-hidden", "false");
    burgerToggle.setAttribute("aria-expanded", "true");
  };

  burgerToggle.addEventListener("click", () => {
    const isOpen = burgerPanel.classList.contains("is-open");
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  burgerBackdrop.addEventListener("click", closeMenu);
  burgerClose.addEventListener("click", closeMenu);

  document.querySelectorAll(".burger-links a[data-link]").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
}

function bindAgentDrawer() {
  const fab = document.getElementById("agentFab");
  const drawer = document.getElementById("agentDrawer");
  const close = document.getElementById("agentClose");
  const input = document.getElementById("agentInput");

  if (!fab || !drawer || !close || !input) return;

  const openDrawer = () => {
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    input.focus();
  };

  const closeDrawer = () => {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
  };

  fab.addEventListener("click", () => {
    if (drawer.classList.contains("is-open")) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  close.addEventListener("click", closeDrawer);

  document.querySelectorAll(".chip--command").forEach((chip) => {
    chip.addEventListener("click", () => {
      const command = chip.getAttribute("data-command") || "";
      input.value = command;
      input.focus();
    });
  });
}

function bindLangSwitch() {
  const toggle = document.getElementById("langToggle");
  if (!toggle) return;

  toggle.checked = currentLang === "en";
  toggle.addEventListener("change", () => {
    currentLang = toggle.checked ? "en" : "ru";
    localStorage.setItem(storageKey, currentLang);
    applyTranslations();
    render(window.location.pathname);
  });
}

function getFallback(key) {
  return (fallbackData[currentLang] && fallbackData[currentLang][key]) || fallbackData.en[key];
}

async function render(path) {
  if (path === "/") {
    window.history.replaceState({}, "", "/backlog");
    path = "/backlog";
  }

  const route = routes[path];
  if (!route) {
    app.innerHTML = `
      <section class="panel empty-state">
        <div class="panel-title">404</div>
        <p>${t("notice.no_data")}</p>
        <div class="panel-actions">
          <a class="btn btn--accent" href="/backlog" data-link>${t("btn.back")}</a>
        </div>
      </section>
    `;
    setActiveLinks(path);
    bindGlobalActions();
    return;
  }

  setTitle(route.titleKey);
  app.innerHTML = renderLoading(route.titleKey);
  setActiveLinks(path);

  try {
    const data = await route.load();
    currentSuggestOps = data.suggest_ops || [];
    currentContext = route.key;
    lastApproveId = null;
    app.innerHTML = renderView(route.key, data);
    updateFooterSnapshot(data.snapshot);
  } catch (error) {
    const fallback = getFallback(route.key);
    if (fallback) {
      currentSuggestOps = fallback.suggest_ops || [];
      currentContext = route.key;
      lastApproveId = null;
      app.innerHTML = renderView(route.key, fallback, {
        notice: t("notice.fallback"),
      });
      updateFooterSnapshot(fallback.snapshot);
    } else {
      app.innerHTML = renderError();
      updateFooterSnapshot(null);
    }
  }

  applyTranslations();
  loadApiStatus();
  bindPanelActions();
  bindGlobalActions();
}

function renderView(key, data, options = {}) {
  switch (key) {
    case "backlog":
      return renderBacklog(data, options);
    case "week":
      return renderWeek(data, options);
    case "today":
      return renderToday(data, options);
    case "metrics":
      return renderMetrics(data, options);
    case "timeline":
      return renderTimeline(data, options);
    case "month":
      return renderMonth(data, options);
    case "memory":
      return renderMemory(data, options);
    case "performer":
      return renderPerformer(data, options);
    default:
      return renderError();
  }
}

function onNavigate(event) {
  const link = event.target.closest("a[data-link]");
  if (!link) return;
  event.preventDefault();

  const path = link.getAttribute("href");
  window.history.pushState({}, "", path);
  render(path);
}

window.addEventListener("popstate", () => render(window.location.pathname));
window.addEventListener("click", onNavigate);

applyTranslations();
bindBurgerMenu();
bindAgentDrawer();
bindLangSwitch();
render(window.location.pathname);
