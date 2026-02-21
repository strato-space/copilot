# Deep Research Report (Draft): OSS-платформы для OperOps + FinOps + Guide + Voice в Copilot

**Основание:** `/home/strato-space/copilot/plan/deep-research-oss-platforms-operops-finops.md`  
**Контекстные требования (ключевые):**
- OperOps PRD/SRS/UX: `/home/strato-space/y-tasks-sandbox/str-mainflow/operops/Operops.md`
- Voice→OperOps spec: `/home/strato-space/y-tasks-sandbox/str-mainflow/operops/Spec Voice - OperOps.md`
- FinOps MVP: `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/01-finops-main.md`
- Guide (Directories Hub): `/home/strato-space/y-tasks-sandbox/str-mainflow/Guide.md`
- Agent Layer: `/home/strato-space/y-tasks-sandbox/str-mainflow/AgentLayer.md`

**Дата актуальности анализа:** 2026-02-21

> Примечание: этот документ — **черновик-скелет**. Он фиксирует архитектурные инварианты, критерии оценки и первичный shortlist по категориям. Перед финализацией нужно пройтись по первоисточникам (docs/licenses/issues) выбранных OSS-проектов.

---

## 1) Executive summary

### Рабочая гипотеза
Для Copilot (OperOps/FinOps/Guide/Voice + Agent Layer) **лучше composable stack**, а не монолитная ERP/«суперплатформа».

Причины (связь с требованиями):
- OperOps и Voice требуют **human-in-the-loop** и обратимых изменений (Suggest→Approve→Apply, Timeline/Revert), а также долгоживущих процессов и idempotency.
- FinOps требует строгого **аудита**, версий прогноза, lock периода и детерминированных правил расчёта.
- Guide — это справочники/контекст (ID-стратегия), которые должны стать **source-of-truth** для агентов и модулей.
- Агентный контур фиксирован (Codex + fast-agent + beads + ACP + текущий RAG), значит «платформа» должна **встраиваться**, а не пытаться заменить всё.

### Первичная рекомендация (направление)
- **Option A (MVP-first)**: Postgres + (лёгкий workflow) + строгий audit/event log + минимальная шина событий + Keycloak; BI/ETL — по необходимости; RAG остаётся текущий.
- **Option B (Balanced)**: добавить полноценный workflow (Temporal) + NATS/Kafka как backbone + OpenSearch/Qdrant для поиска/векторов + Airbyte+dbt для витрин + Metabase/Superset.
- **Option C (Scale-first)**: event-driven платформа (Kafka/Redpanda + Temporal + CDC + lakehouse/Trino) — оправдано только если заранее известно, что объёмы/сложность взлетят и команда готова к росту операционной сложности.

---

## 2) Assumptions & constraints

### 2.1 Фиксированный стек (из постановки)
- Coding agent: **OpenAI Codex**
- Агентная платформа: **fast-agent**
- Трекер задач/прогресса агентов: **beads** (git-backed graph)
- Интеграционный протокол: **ACP** + **acp-plugin**
- RAG-контур: **vertex-rag-mcp** (нельзя игнорировать)

### 2.2 Архитектурные инварианты требований
**OperOps**:
- поток **Voice → Plan → Backlog**
- изменения в CRM строго через **Suggest → Approve → Apply**
- обязательны: **preview diff**, **dry-run**, **partial apply**, **Timeline**, **Revert**

**FinOps**:
- plan-fact на год (фокус 3 месяца), версии прогноза
- закрытие месяца (lock), аудит, комментарии/вложения
- FX avg month + (для будущего) FX forecast

**Guide**:
- единые справочники (Track→Client→Project), aliases
- Project Context обязателен как вход в agent layer
- импорт из automation/CRM без «молчаливого затирания» вручную заполненных полей

**Agent Layer**:
- один thread на объект (voice_session/plan_item/crm_task)
- evidence/audit по умолчанию
- политики: confidence gating, dry-run, partial apply, retry

### 2.3 Обязательный дизайн-контур (Figma)
Нужна **глубокая интеграция с Figma** (read/write, дизайн-система, drift control).

---

## 3) Методика оценки (веса)

Используем веса из постановки (sum=100):
- Functional fit: 18
- Integration fit with current stack: 14
- Data/audit integrity: 11
- Operational complexity: 11
- Licensing/compliance risk: 7
- Community/maturity: 7
- Time-to-value: 7
- Compatibility with Codex/fast-agent/beads: 10
- Figma integration maturity: 10
- ACP/acp-plugin compatibility: 5

**Шкала:** 1–5 по каждому критерию.

---

## 4) Longlist → Shortlist (первичный черновик)

> Важно: ниже список «кандидатов по памяти». Перед финализацией нужно подтвердить лицензии/активность/интеграции по первоисточникам.

### 4.1 Workflow / Orchestration / BPM
**Longlist:** Temporal, Camunda, n8n, Kestra, Apache Airflow, Prefect, Dagster

**Shortlist (черновик):**
- **Temporal** — сильный кандидат под долгоживущие процессы (approve/apply/retry), чёткая модель идемпотентности.
- **n8n** — быстрый time-to-value для glue-автоматизаций (не как backbone).

### 4.2 Event bus / Audit / Event sourcing
**Longlist:** NATS JetStream, Kafka/Redpanda, Pulsar, RabbitMQ; EventStoreDB; Postgres append-only event log

**Shortlist (черновик):**
- **NATS JetStream** — проще операционно, хорош для command/event шины в MVP.
- **Kafka/Redpanda** — если нужен высокий throughput и экосистема коннекторов/CDC.
- **Postgres event log** (append-only) — обязательный слой даже при наличии шины: для детерминированного аудита и восстановимости.

### 4.3 Knowledge / Search / RAG
**Сейчас:** vertex-rag-mcp.

**Longlist:** OpenSearch, Elasticsearch OSS (проверить), Typesense, Meilisearch; Qdrant, Weaviate, Milvus

**Shortlist (черновик):**
- **OpenSearch** — полнотекст + лог-аналитика (частично).
- **Qdrant** — простой в эксплуатации векторный слой (если понадобится вынос из текущего контура).

### 4.4 ETL/ELT + трансформации
**Longlist:** Airbyte, Meltano, Singer ecosystem, Debezium (CDC), dbt Core

**Shortlist (черновик):**
- **Airbyte + dbt** — стандартный маршрут для построения витрин под BI.
- **Debezium** — если пойдём в CDC из CRM/automation.

### 4.5 Analytics / BI
**Longlist:** Metabase, Apache Superset, Grafana

**Shortlist (черновик):**
- **Metabase** — быстрый доступ к управленческой аналитике.
- **Superset** — если нужны более сложные дашборды/гранулярные права.

### 4.6 IAM / RBAC / SSO
**Longlist:** Keycloak

**Shortlist:**
- **Keycloak** — де-факто OSS для OIDC/SAML, RBAC, аудит логинов.

### 4.7 Feature flags / config governance
**Longlist:** Unleash, Flagsmith

**Shortlist:**
- **Unleash** — простая модель флагов, подходит для включения режимов/агентов.

### 4.8 Observability / Incident
**Longlist:** OpenTelemetry, Prometheus, Grafana, Loki, Tempo, Alertmanager

**Shortlist:**
- **OTel + Prometheus + Grafana** (метрики)
- **Loki/Tempo** (логи/трейсы) — по зрелости команды

### 4.9 OperOps / Task & project execution platforms
Поскольку CRM остаётся source-of-truth по задачам в MVP, эти платформы рассматриваем как:
- либо «операционный слой поверх CRM»
- либо как будущую замену CRM (не в MVP)

**Longlist:** Plane, OpenProject, Taiga, Focalboard

**Shortlist (черновик):**
- **не выбирать сейчас** как backbone (в MVP), чтобы не спровоцировать миграцию. Используем beads + CRM + собственный слой OperOps.

### 4.10 FinOps / ERP / accounting backbone
**Гипотеза:** под ваш plan-fact + lock + audit проще и быстрее собрать свой доменный слой на Postgres, чем тащить ERP.

**Longlist:** ERPNext, Odoo Community, Dolibarr

**Shortlist (черновик):**
- **не брать ERP как ядро MVP** (риск сложной кастомизации и торможения).

### 4.11 Figma / design-system automation
**Кандидаты:** работа через Figma API + собственные агенты; вспомогательные тулзы вокруг design tokens.

**Shortlist (черновик):**
- **собственный “DesignOps MCP”**: read/write к Figma + операции над variables/tokens/components.

---

## 5) Рекомендованный стек

### Option A: MVP-first (0–3 месяца)
- **DB:** Postgres
- **Audit:** append-only события в Postgres + человекочитаемый diff
- **Workflow:** минимальный (внутренний) + очереди; либо сразу Temporal, если команда готова
- **Eventing:** NATS (если нужен) или Postgres NOTIFY/очередь на старте
- **IAM:** Keycloak
- **Observability:** OTel + Prometheus + Grafana
- **Search/RAG:** оставить vertex-rag-mcp
- **Figma:** MCP-коннектор к Figma API (read/write)

### Option B: Balanced (3–12 месяцев)
- Temporal + NATS/Kafka
- OpenSearch + Qdrant
- Airbyte + dbt + витрина (Postgres/ClickHouse — определить позже)
- Metabase/Superset

### Option C: Scale-first
- Kafka/Redpanda + Temporal + CDC (Debezium)
- Lakehouse (Iceberg) + Trino (если действительно нужно)

---

## 6) Референсная архитектура (черновик)

### 6.1 Контур выполнения
`Codex ↔ fast-agent ↔ beads ↔ ACP ↔ Copilot services`

### 6.2 Контур UI/DesignOps
`Agents ↔ Figma ↔ Design System ↔ Frontend code`

### 6.3 Контур аудита
`(command) Suggest → Approve → Apply → TimelineEvent → Revert`

---

## 7) План внедрения на 90 дней (Wave 1/2/3)

### Wave 1 (0–30 дней): foundation + MVP контур
1) Единый audit/event log (append-only) для OperOps/FinOps/Guide
2) Каркас Suggest/Approve/Apply с dry-run и partial apply
3) Keycloak + базовый RBAC (Admin-only как в MVP)
4) Минимальная наблюдаемость (метрики/логи ключевых операций)
5) DesignOps: Figma MCP read/write POC

### Wave 2 (31–60 дней): стабилизация + данные + витрины
1) Стабилизация workflow (Temporal или эквивалент)
2) Guide import + редактирование Project Context + алиасы
3) FinOps: версии прогноза + lock месяца + FX слой
4) Первые BI-дашборды (управленческие)

### Wave 3 (61–90 дней): scale-готовность
1) Event bus (если нужен) и разнесение доменных сервисов
2) Улучшение RAG/search
3) Drift-control между Figma и кодом (полуавтомат + отчёты)

---

## 8) POC backlog (черновик 12 задач)
1) POC: append-only audit log + human diff
2) POC: Suggest→Approve→Apply пайплайн с idempotency key
3) POC: partial apply + retry policy
4) POC: Timeline + Revert (для create/update CRM task)
5) POC: Agent Layer thread-per-object (voice_session/plan_item/crm_task)
6) POC: интеграция beads (создание/обновление узлов/рёбер под Plan/Backlog)
7) POC: ACP интеграция на одном сквозном кейсе (Voice→Plan)
8) POC: Figma MCP — чтение/запись variables + генерация токенов
9) POC: Figma MCP — изменение компонента/варианта + фиксация истории
10) POC: FinOps lock месяца + блок правок + audit
11) POC: FX avg month + fallback manual + audit
12) POC: минимальный дашборд (Metabase/Grafana) по KPI OperOps и FinOps

---

## 9) Риски и mitigation
- Риск: рост операционной сложности при раннем вводе Kafka/больших платформ → **начать с Option A/B**.
- Риск: качество транскриптов/нехватка структуры → **confidence gating + needs_verify**.
- Риск: drift дизайн↔код → **встроить отчётность и полуавтоматический цикл**, не пытаться сразу сделать «магический» full auto.

---

## 10) Appendix
- TODO: ссылки на официальные docs/repos/licenses/issues выбранных OSS (добавить при финализации).
