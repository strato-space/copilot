# Deep Research Task: OSS-платформы для реализации OperOps + FinOps + Guide + Voice в Copilot

**Дата постановки:** 2026-02-21  
**Формат:** исследовательский отчет с рекомендациями по выбору OSS-платформ и roadmap внедрения  
**Главная цель:** определить, какие open-source платформы (и в какой комбинации) максимально ускорят реализацию текущих планов по OperOps/FinOps/Guide/Voice при сохранении совместимости с существующим стеком Copilot.

## 1) Цель и ожидаемый результат

Нужно подготовить обоснованное решение:
1. Какие OSS-платформы использовать в MVP (0-3 месяца).
2. Какие OSS-платформы использовать в Scale-фазе (3-12 месяцев).
3. Какие варианты не подходят и почему.

Результат должен быть пригоден для принятия архитектурного решения и запуска implementation backlog без повторного исследования с нуля.

## 2) Обязательные рамки и технологические ограничения

### 2.1 Стратегические вводные (фиксированные)

- Coding agent: **OpenAI Codex**.
- Агентная платформа: **fast-agent**  
  https://github.com/evalstate/fast-agent
- Трекер задач/прогресса AI-агентов: **beads** (distributed, git-backed graph issue tracker)  
  https://github.com/steveyegge/beads
- Ставка на **ACP** (как целевой интеграционный протокол).
- ACP plugin в текущем контуре:  
  https://github.com/strato-space/acp-plugin
- Существующий RAG-контур, который нельзя игнорировать:  
  https://github.com/strato-space/vertex-rag-mcp

### 2.2 Обязательный дизайн-контур (Figma)

Исследование обязано покрыть **глубокую интеграцию с Figma**, включая:
- read/write доступ из агентов;
- активное редактирование UI-макетов агентами;
- создание и сопровождение дизайн-системы (variables, tokens, component sets, variants, docs);
- контроль drift между кодом и дизайном (design-to-code и code-to-design loop).

## 3) MCP и AgentFab: опорные ссылки

Использовать как источник истины по доступным MCP и инструментам:

- Логический перечень MCP/инструментов (AgentFab):  
  `/home/strato-space/prompt/AgentFab/catalogs/tools.yml`
- Документация AgentFab, где закреплена роль `tools.yml` как списка MCP/сервисов:  
  `/home/strato-space/prompt/AgentFab/docs/readme.md`
- Физический runtime-перечень MCP-серверов (enabled/disabled, transport, endpoints):  
  `/home/tools/call/mcp_config.yaml`

## 4) Обязательные входные документы (проектный контекст)

### 4.1 Str-mainflow / y-tasks-sandbox

- `/home/strato-space/y-tasks-sandbox/str-mainflow/main/STR-OpsPortal.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/Guide.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/AgentLayer.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/operops/Operops.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/operops/Spec Voice - OperOps.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/01-finops-main.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/02-finops-rasxod.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/03-finops-analytic.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/04-finops-agentsidebar.md`
- `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/spec.md`
- `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/TZ.md`
- `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/plan.md`
- `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/tasks.md`
- `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/discovery.md`

### 4.2 Copilot documentation

- `/home/strato-space/copilot/README.md`
- `/home/strato-space/copilot/AGENTS.md`
- `/home/strato-space/copilot/docs/finance-ops/README.md`
- `/home/strato-space/copilot/docs/FINOPS_REALIZTION.md`
- `/home/strato-space/copilot/docs/FINANCES_BACKEND_PLAN.md`
- `/home/strato-space/copilot/docs/MERGING_FRONTENDS_PLAN.md`
- `/home/strato-space/copilot/docs/MERGING_PROJECTS_PLAN.md`
- `/home/strato-space/copilot/docs/REPORTS_SETUP.md`
- `/home/strato-space/copilot/docs/VOICEBOT_API.md`
- `/home/strato-space/copilot/docs/voicebot-plan-sync/README.md`
- `/home/strato-space/copilot/projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/spec.md`
- `/home/strato-space/copilot/projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/TZ.md`
- `/home/strato-space/copilot/specs/specs/003-unified-frontend-embed/spec.md`

## 5) Что именно исследовать

Сформировать longlist и shortlist OSS-решений по категориям:
1. Workflow/Orchestration/BPM.
2. OperOps / task & project execution platforms.
3. FinOps/ERP/accounting backbone.
4. Data ingestion/ETL/ELT + transformations.
5. Analytics/BI layer.
6. Audit/event sourcing/event bus.
7. Knowledge/RAG/search layer.
8. IAM/RBAC/SSO layer.
9. Feature flags/config governance.
10. Observability/incident tooling.
11. Figma/design-system automation layer.
12. Agent runtime ecosystem alignment (Codex + fast-agent + beads + ACP).

## 6) Ключевые исследовательские вопросы

1. Какие OSS-решения лучше закрывают Voice -> Plan -> Backlog без переделки всего продукта?
2. Какой OSS-контур лучше подходит для FinOps plan-fact + FX + month lock + audit?
3. Что лучше для нас: монолитная ERP/операционная платформа или composable stack?
4. Как обеспечить единый source-of-truth для Guide/OperOps/FinOps?
5. Как минимизировать vendor lock-in и сохранить скорость доставки?
6. Как лучше встроить стек Codex + fast-agent + beads в ежедневную разработку и execution loop?
7. Как встроить ACP/acp-plugin в runtime архитектуру без роста операционной сложности?
8. Как обеспечить глубокую Figma-интеграцию (агентное редактирование макетов + дизайн-система + drift-control)?
9. Какие части существующего `vertex-rag-mcp` нужно сохранить, расширить или заменить?

## 7) Обязательный формат результата

Итоговый отчет в Markdown:

1. Executive summary (1-2 страницы).
2. Assumptions & constraints.
3. Longlist -> shortlist (и причины отсева).
4. Сравнительная матрица (weighted scoring).
5. Рекомендованный стек:
   - Option A: MVP-first (минимум изменений)
   - Option B: Balanced
   - Option C: Scale-first
6. Референсная архитектура:
   - `Codex <-> fast-agent <-> beads <-> ACP <-> Copilot services`
   - `Agents <-> Figma <-> Design System <-> Frontend code`
7. План внедрения на 90 дней (Wave 1/2/3).
8. POC backlog (10-20 задач) с критериями успеха.
9. Риски + mitigation plan.
10. Appendix: ссылки на официальные источники (docs/repos/licenses).

## 8) Методика оценки (weights, sum=100)

- Functional fit: **18%**
- Integration fit with current stack: **14%**
- Data/audit integrity: **11%**
- Operational complexity: **11%**
- Licensing/compliance risk: **7%**
- Community/maturity: **7%**
- Time-to-value: **7%**
- Compatibility with Codex/fast-agent/beads: **10%**
- Figma integration maturity (read/write + design system ops): **10%**
- ACP/acp-plugin compatibility: **5%**

## 9) Требования к качеству исследования

- Использовать первичные источники: официальная документация, лицензии, репозитории, issue trackers.
- По каждой рекомендации явно показывать trade-offs и `why not`.
- Не ограничиваться общими фразами: указывать конкретные integration points с нашими документами/модулями.
- Отдельно оценить размер required custom development (S/M/L + ориентир по времени).
- Зафиксировать абсолютную дату актуальности анализа.

## 10) Практический deliverable для команды

В финале исследование должно дать:
1. Decision-ready shortlist (3-6 платформ/комбинаций).
2. Четкий MVP stack на 90 дней.
3. Поэтапный migration path без остановки текущей разработки.
4. Ясное решение по Figma и design-system automation.
5. Ясное решение по роли ACP и развитию `vertex-rag-mcp`.

