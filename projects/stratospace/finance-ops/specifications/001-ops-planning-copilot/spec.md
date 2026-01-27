# Спецификация фичи: [НАЗВАНИЕ ФИЧИ]

**Ветка фичи**: `[###-feature-name]`  
**Создано**: [DATE]  
**Статус**: Draft  
**Ввод**: описание пользователя: "$ARGUMENTS"

## Пользовательские сценарии и тестирование *(обязательно)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
  NOTE (language): Write this spec mostly in Russian. Use English only where unavoidable:
  file/folder names, code identifiers, API/JSON field names, status slugs, tool/library names.
-->

### User Story 1 — [Короткий заголовок] (Приоритет: P1)

[Опиши сценарий простым языком]

**Почему такой приоритет**: [В чём ценность и почему это P1]

**Independent Test**: [Как проверить отдельно — например: “достаточно сделать X и увидеть Y”]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 — [Короткий заголовок] (Приоритет: P2)

[Опиши сценарий простым языком]

**Почему такой приоритет**: [В чём ценность и почему это P2]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 — [Короткий заголовок] (Приоритет: P3)

[Опиши сценарий простым языком]

**Почему такой приоритет**: [В чём ценность и почему это P3]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Добавь дополнительные User Story при необходимости (P4, P5…), сохраняя тот же формат]

### Edge Cases / Пограничные случаи

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- Что происходит, когда [граничное условие]?
- Как система обрабатывает [ошибка/исключение]?

## Требования *(обязательно)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Функциональные требования

- **FR-001**: Система ДОЛЖНА [конкретная возможность, напр. “создавать сущность X”]
- **FR-002**: Система ДОЛЖНА [валидация/ограничение, напр. “проверять формат email”]
- **FR-003**: Пользователь ДОЛЖЕН иметь возможность [ключевое действие, напр. “сбросить пароль”]
- **FR-004**: Система ДОЛЖНА [требование к данным, напр. “сохранять настройки”]
- **FR-005**: Система ДОЛЖНА [поведение, напр. “логировать события безопасности”]

*Пример пометки неопределённости:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Ключевые сущности *(если фича про данные)*

- **[Entity 1]**: [что представляет; ключевые атрибуты без реализации]
- **[Entity 2]**: [что представляет; связи с другими сущностями]

## Критерии успеха *(обязательно)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Измеримые результаты

- **SC-001**: [метрика, напр. “пользователь завершает сценарий X < 2 минут”]
- **SC-002**: [метрика, напр. “система выдерживает 1000 одновременных пользователей без деградации”]
- **SC-003**: [качество UX, напр. “90% пользователей выполняют основной сценарий с первого раза”]
- **SC-004**: [бизнес-метрика, напр. “снизить обращения в поддержку по теме X на 50%”]
