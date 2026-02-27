# FPF Extraction Protocol: ERD-кандидаты для `STR-OpsPortal.md` (без извлечения на этом шаге)

**Документ-цель:** задать воспроизводимый протокол, как из текста `STR-OpsPortal.md` выделять:
- `Entity` (объекты предметной области),
- `Attribute` (атрибуты/характеристики),
- `Relationship` (связи и ограничения),
с опорой на паттерны FPF.

**Ограничение текущего шага:** фактическое извлечение сущностей/связей не выполняется.

## 1. Вход и рамки

**Источник для будущего прохода:**
- `/home/strato-space/y-tasks-sandbox/str-mainflow/main/STR-OpsPortal.md`

**Нормативные опоры FPF (что использовать):**
- `A.6.P` (semantic precision upgrade)
- `A.6.5` (SlotKind / ValueKind / RefKind)
- `C.3.1` (`U.Kind`, `U.SubkindOf`)
- `A.14` (типы parthood: `ComponentOf`, `PortionOf`, `PhaseOf`, `MemberOf`)
- `A.17` (`Characteristic` для атрибутов)
- `F.7` (Concept-Set rows)
- `F.9` (Bridge + CL/Loss)
- `F.17` (UTS row schema)
- `F.18` (Name Card)

## 2. Выходные артефакты (что должно получиться после выполнения протокола)

1. `Entity Catalog` (кандидаты сущностей с типизацией `Kind`).
2. `Attribute Catalog` (характеристики сущностей и измеримость).
3. `Relationship Catalog` (типы связей + кардинальности + ограничения).
4. `Context/Bridge Table` (если в тексте смешаны контексты терминов).
5. `ERD Projection` (проекция FPF-структуры в классический ERD формат).
6. `Open Issues` (неопределенности, требующие доменного решения).

## 3. Фаза A: Подготовка корпуса и контекстов

1. Зафиксировать edition/версию исходного документа (дата, commit/ref, если есть).
2. Разбить текст на семантические блоки:
- роль/актор,
- объекты данных,
- процессы/события,
- правила/ограничения.
3. Завести `Context Register`:
- какой термин в каком `Bounded Context` используется,
- где возможна коллизия значений.

**Шаблон: Context Register**

| term | local meaning | bounded context | evidence line/section | risk |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | low/med/high |

## 4. Фаза B: Precision Upgrade по A.6.P (до любой ERD-нотации)

Для каждого нагруженного утверждения в тексте:
1. Найти триггеры расплывчатости:
- umbrella verbs (`sync`, `manage`, `handle`, `support`, `connect`),
- неявные указатели (`it`, `this`, `они`, `это`),
- смешение design/run.
2. Распаковать локальную мини-онтологию:
- какие `Kind` участвуют,
- какие роли,
- какой scope/time/viewpoint.
3. Выбрать стабильный субстрат представления:
- typed relation/hyperedge,
- record with named slots.
4. Зафиксировать rewrite:
- было (сырой текст),
- стало (typed statement с явными участниками и ограничениями).

**Шаблон: Precision Rewrite Log**

| id | source text fragment | ambiguity trigger | normalized typed statement | notes |
|---|---|---|---|---|
| PR-001 | TBD | TBD | TBD | TBD |

## 5. Фаза C: Entity/Attribute/Relationship кандидаты через A.6.5 + C.3.1 + A.17 + A.14

### 5.1 Entity кандидаты

1. Каждый кандидат должен иметь:
- `EntityID`,
- `Kind` (context-local),
- `Definition` (минимально однозначная).
2. Для иерархий использовать `SubkindOf` (а не "scope widening").

**Шаблон: Entity Catalog**

| entity_id | label | kind | parent_kind (optional) | definition | source |
|---|---|---|---|---|---|
| E-001 | TBD | TBD | TBD | TBD | section X |

### 5.2 Attribute кандидаты

1. Атрибут фиксировать как `Characteristic` (`A.17`), не как свободный "dimension/axis".
2. Для каждого атрибута фиксировать:
- тип значения,
- единицы/шкалу,
- nullable/mandatory,
- кто является носителем (entity scope).

**Шаблон: Attribute Catalog**

| attr_id | entity_id | characteristic | value_type | unit/scale | constraint | source |
|---|---|---|---|---|---|---|
| A-001 | E-001 | TBD | string/int/enum/etc | TBD | TBD | section X |

### 5.3 Relationship кандидаты

1. Для каждой связи применить triple из `A.6.5`:
- `SlotKind`: позиция участника в связи,
- `ValueKind`: допустимый тип участника,
- `RefKind`: как ссылка фиксируется.
2. Разделять:
- структурные связи,
- эпистемические связи.
3. Для `part-of` использовать точный тип из `A.14`, а не общий "part".

**Шаблон: Relationship Catalog**

| rel_id | relation_name | relation_kind | from_entity | to_entity | cardinality | slot/value/ref notes | constraints | source |
|---|---|---|---|---|---|---|---|---|
| R-001 | TBD | structural/epistemic | E-001 | E-002 | 1:N | TBD | TBD | section X |

## 6. Фаза D: Нормализация терминов через F.7 / F.9 / F.18 / F.17

1. Создать `Name Card` (`F.18`) для каждого термина с высокой нагрузкой:
- context,
- kind,
- MDS,
- relation-kind (если термин о связи).
2. Собрать `Concept-Set` строки (`F.7`) по пересекающимся терминам.
3. Там, где контексты разные, фиксировать `Bridge` (`F.9`) с `CL` и `Loss`.
4. Подготовить UTS-представление (`F.17`) как публикационный слой.

**Шаблон: Bridge Register**

| bridge_id | term_a (context A) | term_b (context B) | bridge_kind | CL | loss note | substitution allowed |
|---|---|---|---|---|---|---|
| B-001 | TBD | TBD | approx/narrower/broader/overlap/etc | 0..3 | TBD | yes/no |

## 7. Фаза E: Проекция в ERD

После завершения фаз A-D выполнить проекцию:
1. `Entity Catalog` -> ERD `Entities`.
2. `Attribute Catalog` -> ERD `Attributes`.
3. `Relationship Catalog` -> ERD `Relationships` + cardinalities.
4. `Bridge Register` -> ERD `notes/annotations` (не всегда как физические связи).

**Правила проекции:**
- Не переносить в ERD элементы, не прошедшие `Kind`-идентификацию.
- Не сливать две сущности "по похожему названию" без bridge/обоснования.
- Не кодировать process-order как structural part-of.
- При конфликте context meanings: оставлять раздельные сущности и фиксировать bridge.

## 8. Контроль качества (Definition of Done для extraction)

1. Нет неопределенных сущностей без `kind` и определения.
2. Нет связей без кардинальности и без источника в тексте.
3. Для каждого `part-of` указан конкретный тип (`ComponentOf`/`PortionOf`/`PhaseOf`/`MemberOf`).
4. Атрибуты оформлены как `Characteristic` с типом/шкалой.
5. Коллизии терминов закрыты `Bridge`-записями либо явным split.
6. Есть журнал неопределенностей (`Open Issues`) для решений с доменными экспертами.

## 9. Что не делать (антипаттерны)

1. Делать ERD напрямую из "гладкого" текста без `A.6.P` rewrite.
2. Смешивать role/method/work в одну сущность.
3. Подменять relationship semantics строковым сходством имен.
4. Превращать все отношения в generic `related_to`.
5. Терять source traceability (каждая сущность/атрибут/связь должна иметь ссылку на фрагмент текста).

## 10. План применения протокола к `STR-OpsPortal.md` (когда дадите команду на выделение)

1. Пройти документ блоками и заполнить `Precision Rewrite Log`.
2. Собрать первичные `Entity/Attribute/Relationship` каталоги.
3. Прогнать терминологическую нормализацию (`F.18`, `F.7`, `F.9`).
4. Сформировать `UTS`-срез (`F.17`) и затем ERD projection.
5. Вернуть:
- ERD-таблицы,
- список допущений,
- список спорных мест для решения.
