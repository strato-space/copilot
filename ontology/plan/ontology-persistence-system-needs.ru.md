# System Needs: Ontology Persistence Layer

## Статус

- Язык: русский.
- Назначение: верификационный список требований для `ontology-persistence-db-spec.md`.
- Роль: generic persistence requirements для ontology-driven persistence, без domain-specific entity catalog.
- Граница: voice/task-specific persistence alignment выносится в `ontology/plan/voice-ontology-persistence-alignment-spec.md`.
- Все идентификаторы `SN-*` стабильны и должны совпадать с английской версией.

Онтологическая рамка для этого документа:
- различаются `schema order`, `card order`, `instance order`, `storage order`, `result order`;
- под `типом` здесь понимается persistence-bearing схемный тип сущности или отношения;
- `TQL card` здесь означает нормативный аннотированный TQL-блок, а не вторую схему;
- `instance` здесь означает конкретное persisted occurrence, а не TQL-объявление;
- `projection` здесь означает валидированное подмножество возвращаемого результата, а не новую сущность и не новую запись;
- standalone `attribute` types регулируются TQL-объявлениями и owning card, а не отдельными persistence cards.

## Онтологическая дисциплина и формальные определения

- `SN-038` Спека должна явно определять `TypeDB 3.x`, `MongoDB`, `type`, `entity`, `relation`, `attribute`, `TQL card`, `instance`, `materialization`, `authority`, `projection`, `TOON` и `soft delete` в терминах, достаточных для строго математически ориентированного чтения.
- `SN-040` Спека должна явно различать `schema order`, `card order`, `instance order`, `storage order` и `result order` и не переносить утверждения из одного порядка в другой без явной деривации.
- `SN-041` Спека должна явно фиксировать отрицательные разграничения: `entity` не тождествен MongoDB document shape; `relation` не редуцируется к incidental join artifact; `attribute` не является самостоятельным объектом политики персистентности; `TQL card` не является второй schema language; `TOON` не является вторым authoring format.

## Авторитет и источник истины

- `SN-001` Для каждого схемного типа сущности или отношения, для которого задаётся политика персистентности, должен существовать ровно один авторитетный TQL card.
- `SN-002` TQL card должен быть единственным источником имен entity, relation и attribute.
- `SN-003` Все, что не выражается синтаксисом TypeDB 3.x, должно быть объявлено только в мета-блоке комментариев перед TQL, а не во втором файле-двойнике.
- `SN-004` `TOON` не должен становиться вторым источником истины; он допустим только как производный формат вывода.

## Материализация и authority

- `SN-005` Для каждого persistence-bearing схемного типа сущности или отношения должно быть явно указано, материализуется ли он в `TypeDB`, `MongoDB` или в обоих.
- `SN-006` Для каждого dual-materialized типа должен быть указан ровно один authority backend.
- `SN-007` `authority=both` запрещён.
- `SN-008` По умолчанию TQL label типа должен совпадать с именем MongoDB collection, если не задан явный override.
- `SN-009` По умолчанию TQL label атрибута должен совпадать с именем поля MongoDB, если не задан явный override.
- `SN-010` Override collection/field names должен быть явным и локальным для card, а не размазанным по произвольному коду.

## Типизация и запись

- `SN-011` Проверка типов по TQL card должна выполняться перед каждой durable write operation, даже если часть атрибутов физически хранится только в MongoDB.
- `SN-012` Value domains, выраженные через TQL constraints (`@values`, `@regex`, `@range`, value type), должны автоматически попадать в runtime validators.
- `SN-013` Запись должна быть разрешена только в базы, указанные в card.
- `SN-014` Прямой untyped write в MongoDB или TypeDB в обход card-derived validators должен считаться нарушением контракта.

## Boot и generation

- `SN-015` Процедура сохранения при старте сервиса должна читать `TQL fragment` и `metadata fragment` из annotated TQL source, строить или проверять runtime card registry и либо компилировать алгоритм проверки, либо кэшировать его для последующей per-object validation на write path.
- `SN-016` Из TQL card должны генерироваться TypeScript types, runtime validators и typed repository surfaces для persistence-bearing entities и relations.
- `SN-017` Сгенерированный manifest разрешён только как производный build artifact, а не как второй источник истины.

## CRUD, search facade, projection

- `SN-018` CRUD операции должны быть типизированы per-entity/per-relation и выводиться из card; если relation является first-class persistence object, у неё должен существовать явный relation write path.
- `SN-019` Search-facade interface, расположенный над persistence kernel, должен принимать natural-language запрос и entity whitelist.
- `SN-020` Search-facade interface должен принимать projection contract, задающий подмножество полей возвращаемого результата в `result order`.
- `SN-021` Projection contract должен валидироваться против card-declared fields или явно объявленных projection aliases; нельзя запрашивать произвольные неописанные поля.
- `SN-022` Search-facade interface должен уметь возвращать `JSON` и `TOON`, где `TOON` является форматом по умолчанию.
- `SN-023` Для произвольного r/o TQL должен существовать отдельный kernel-governed интерфейс с read-only ограничением.
- `SN-024` Для search facade и r/o TQL должен существовать обязательный `max_tokens` guard; при превышении должен возвращаться error, а не молчаливое усечение.

## Project scope

- `SN-025` Project scoping не должен зависеть только от текста запроса; он должен иметь отдельный машинно-проверяемый аргумент.
- `SN-026` Для каждого project-scoped persistence-bearing entity или relation type в card должен быть объявлен machine-usable project anchor.
- `SN-027` Если для запрошенного persistence-bearing entity или relation type не объявлен project anchor, search/read с project scope должен отклоняться.

## LLM и эволюция схемы

- `SN-028` LLM должен иметь компактный и строгий интерфейс ontology search/read.
- `SN-029` LLM должен иметь путь для предложения изменений системы типов, который модифицирует не только базу, но и TQL definitions с метаинформацией.
- `SN-030` Schema evolution через LLM должна идти через proposal -> validation -> approval -> apply, а не через неявное прямое изменение production schema.

## Корректность и recovery

- `SN-031` Для dual-materialized типов должна быть формально задана стратегия recovery после partial failure.
- `SN-032` Спека не должна утверждать сильную cross-store atomicity без реального координационного механизма.
- `SN-033` Для mirror stores должна существовать идемпотентная replay/reconciliation стратегия.

## Архитектурное расширение

- `SN-034` Архитектура должна позволять вынести subsystem в open source и подключать внешние хранилища кроме MongoDB.
- `SN-035` Adapter contract должен быть достаточно общим для `MongoDB`, `PostgreSQL`, `MySQL`, `SQLite`, `Oracle`.
- `SN-036` Решение не должно зависеть от существования зрелого популярного TypeDB ORM, если такого ORM нет.

## Proof obligations

- `SN-037` Спека должна явно перечислять proof obligations и разделять их на machine-checkable и empirical.

## Deletion semantics

- `SN-039` Удаление по умолчанию должно быть soft delete, то есть простановкой явного deletion-marker attribute, а не физическим удалением записи; спеке также следует явно задавать обычную семантику чтения для soft-deleted объектов.

## Верификационный вопрос

Спека считается достаточной только если она даёт явный ответ на каждое `SN-*` требование, а не скрывает ответы в неформальном prose.
