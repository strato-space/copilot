# Анализ консистентности обратных массивов в API дерева проектов

## Проверенные endpoint'ы

### Frontend: `/operops/projects-tree` ([ProjectsTree.tsx](app/src/pages/operops/ProjectsTree.tsx))

Вызывает следующие API endpoints:
- `customers/create`
- `customers/update`
- `project_groups/create`
- `project_groups/update`
- `project_groups/move`
- `projects/create`
- `projects/update`
- `projects/move`
- `projects/merge`

---

## Результаты проверки

### ✅ PROJECTS операции (поддерживают консистентность)

#### 1. **POST /api/crm/projects/create** ([projects.ts:70-113](backend/src/api/routes/crm/projects.ts))

```typescript
// Создает проект
const newProject = {
    ...project,
    project_group: projectGroupId,  // ✅ Устанавливает прямую связь
    is_active: project.is_active ?? true,
    created_at: now,
    updated_at: now,
};
const dbRes = await db.collection(COLLECTIONS.PROJECTS).insertOne(newProject);

// ✅ ОБНОВЛЯЕТ обратный массив
await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
    { _id: projectGroupId },
    {
        $push: {
            projects_ids: dbRes.insertedId,  // ✅ Добавляет в массив
        },
    }
);
```

**Статус:** ✅ **КОНСИСТЕНТНОСТЬ ПОДДЕРЖИВАЕТСЯ**
- Обновляется прямая связь `project.project_group`
- Обновляется обратный массив `project_group.projects_ids`

---

#### 2. **POST /api/crm/projects/move** ([projects.ts:244-290](backend/src/api/routes/crm/projects.ts))

```typescript
// ✅ Удаляет из source group
if (sourceGroupId) {
    await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
        { _id: sourceGroupId },
        {
            $pull: {
                projects_ids: projectId,  // ✅ Удаляет из массива
            },
        }
    );
}

// ✅ Добавляет в destination group
await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
    { _id: destGroupId },
    {
        $push: {
            projects_ids: projectId,  // ✅ Добавляет в массив
        },
    }
);

// ✅ Обновляет прямую связь
await db.collection(COLLECTIONS.PROJECTS).updateOne(
    { _id: projectId },
    {
        $set: {
            project_group: destGroupId,  // ✅ Обновляет прямую связь
            updated_at: Date.now(),
        },
    }
);
```

**Статус:** ✅ **КОНСИСТЕНТНОСТЬ ПОЛНОСТЬЮ ПОДДЕРЖИВАЕТСЯ**
- Удаляет из `source_group.projects_ids`
- Добавляет в `destination_group.projects_ids`
- Обновляет `project.project_group`

---

### ❌ PROJECT_GROUPS операции (НЕ поддерживают консистентность)

#### 3. **POST /api/crm/project_groups/create** ([projectgroups.ts:96-127](backend/src/api/routes/crm/legacy/projectgroups.ts))

```typescript
const newProjectGroup = {
    ..._.omit(payload, ['_id', 'id']),
    customer: customerId,  // ✅ Устанавливает прямую связь
    projects_ids: Array.isArray(payload.projects_ids) ? payload.projects_ids : [],
    is_active: payload.is_active ?? true,
    created_at: now,
    updated_at: now,
};

const dbRes = await db.collection(COLLECTIONS.PROJECT_GROUPS).insertOne(newProjectGroup);

// ❌ НЕ ОБНОВЛЯЕТ customer.project_groups_ids!
```

**Статус:** ❌ **КОНСИСТЕНТНОСТЬ НЕ ПОДДЕРЖИВАЕТСЯ**
- ✅ Устанавливает прямую связь `project_group.customer`
- ❌ **НЕ обновляет** обратный массив `customer.project_groups_ids`

**Последствия:**
- Новая группа не появится в `customer.project_groups_ids`
- Код, полагающийся на этот массив (например, `planFactService.ts` ДО нашего исправления), не найдет проекты этой группы

---

#### 4. **POST /api/crm/project_groups/move** ([projectgroups.ts:223-277](backend/src/api/routes/crm/legacy/projectgroups.ts))

```typescript
const before = await db.collection(COLLECTIONS.PROJECT_GROUPS).findOne({ _id: groupId });

const updateData: Record<string, unknown> = {
    updated_at: Date.now(),
};

if (newCustomerRaw) {
    const newCustomerId = toObjectId(newCustomerRaw);
    updateData.customer = newCustomerId;  // ✅ Обновляет прямую связь
} else {
    updateData.customer = null;
}

await db.collection(COLLECTIONS.PROJECT_GROUPS)
    .updateOne({ _id: groupId }, { $set: updateData });

// ❌ НЕ УДАЛЯЕТ groupId из before.customer.project_groups_ids
// ❌ НЕ ДОБАВЛЯЕТ groupId в newCustomer.project_groups_ids
```

**Статус:** ❌ **КОНСИСТЕНТНОСТЬ НЕ ПОДДЕРЖИВАЕТСЯ**
- ✅ Обновляет прямую связь `project_group.customer`
- ❌ **НЕ удаляет** из `source_customer.project_groups_ids`
- ❌ **НЕ добавляет** в `destination_customer.project_groups_ids`

**Последствия:**
- Группа остается в массиве старого клиента
- Группа не добавляется в массив нового клиента
- Это **КРИТИЧНАЯ ПРОБЛЕМА** для любого кода, использующего `customer.project_groups_ids`

---

### ⚠️ CUSTOMERS операции (нейтрально)

#### 5. **POST /api/crm/customers/create** ([customers.ts:57-78](backend/src/api/routes/crm/customers.ts))

```typescript
const newCustomer = {
    ...customer,
    is_active: customer.is_active ?? true,
    created_at: now,
    updated_at: now,
    // ⚠️ Не инициализирует project_groups_ids как пустой массив
};

const dbRes = await db.collection(COLLECTIONS.CUSTOMERS).insertOne(newCustomer);
```

**Статус:** ⚠️ **НЕЙТРАЛЬНО**
- Не инициализирует `project_groups_ids` как `[]`
- Но это не критично, так как код проверяет `customer.project_groups_ids ?? []`

---

## Сводная таблица консистентности

| Операция | Endpoint | Прямая связь | Обратный массив | Статус |
|----------|----------|--------------|-----------------|--------|
| **Создать проект** | `POST /projects/create` | ✅ `project.project_group` | ✅ `group.projects_ids` ($push) | ✅ OK |
| **Перенести проект** | `POST /projects/move` | ✅ `project.project_group` | ✅ source/dest `projects_ids` ($pull/$push) | ✅ OK |
| **Создать группу** | `POST /project_groups/create` | ✅ `group.customer` | ❌ `customer.project_groups_ids` | ❌ **БАГ** |
| **Перенести группу** | `POST /project_groups/move` | ✅ `group.customer` | ❌ source/dest `project_groups_ids` | ❌ **БАГ** |
| **Создать клиента** | `POST /customers/create` | N/A | ⚠️ не инициализирует `[]` | ⚠️ OK |

---

## Рекомендации по исправлению

### 🔴 КРИТИЧНО: Исправить project_groups операции

#### Исправление 1: `POST /project_groups/create`

```typescript
const dbRes = await db.collection(COLLECTIONS.PROJECT_GROUPS).insertOne(newProjectGroup);

// ✅ ДОБАВИТЬ: обновить customer.project_groups_ids
if (customerId) {
    await db.collection(COLLECTIONS.CUSTOMERS).updateOne(
        { _id: customerId },
        {
            $push: {
                project_groups_ids: dbRes.insertedId,
            },
        }
    );
}
```

#### Исправление 2: `POST /project_groups/move`

```typescript
const before = await db.collection(COLLECTIONS.PROJECT_GROUPS).findOne({ _id: groupId });

await db.collection(COLLECTIONS.PROJECT_GROUPS)
    .updateOne({ _id: groupId }, { $set: updateData });

// ✅ ДОБАВИТЬ: удалить из старого клиента
if (before.customer) {
    await db.collection(COLLECTIONS.CUSTOMERS).updateOne(
        { _id: before.customer },
        {
            $pull: {
                project_groups_ids: groupId,
            },
        }
    );
}

// ✅ ДОБАВИТЬ: добавить в нового клиента
if (updateData.customer) {
    await db.collection(COLLECTIONS.CUSTOMERS).updateOne(
        { _id: updateData.customer },
        {
            $push: {
                project_groups_ids: groupId,
            },
        }
    );
}
```

---

## Выводы

1. **Projects операции (create/move):** ✅ **Работают правильно** - консистентность полностью поддерживается

2. **Project_groups операции (create/move):** ❌ **КРИТИЧНЫЙ БАГ** - обратные массивы `customer.project_groups_ids` не обновляются

3. **Последствия текущего бага:**
   - При создании новой группы она не добавляется в `customer.project_groups_ids`
   - При переносе группы она остается в старом customer и не добавляется в новый
   - Любой код, полагающийся на `customer.project_groups_ids`, будет работать некорректно
   - Это объясняет почему наши новые проекты не появлялись в plan-fact API!

4. **Почему мы не заметили раньше:**
   - Большинство групп были созданы давно (возможно, миграцией)
   - Группы редко переносятся между клиентами
   - Многие части фронтенда используют прямые связи (`project.project_group`, `group.customer`)

5. **Текущее состояние после нашего исправления:**
   - ✅ `planFactService.ts` теперь использует `project.project_group` вместо массивов
   - ❌ Но другие места (tickets.ts, dictionary.ts) все еще могут работать некорректно из-за пустых массивов
   - ❌ Новые создания/переносы групп продолжат создавать несогласованные данные

---

## План действий

### Немедленные действия (HIGH priority):

1. ✅ **Уже сделано:** Исправили `planFactService.ts` чтобы не полагаться на массивы
2. ❌ **TODO:** Исправить `POST /project_groups/create` чтобы обновлять `customer.project_groups_ids`
3. ❌ **TODO:** Исправить `POST /project_groups/move` чтобы обновлять оба customer'ов
4. ❌ **TODO:** Исправить остальные backend места (tickets.ts, dictionary.ts) чтобы использовать прямые связи

### Опциональные действия (после исправления API):

5. **Миграция данных:** Создать скрипт который заполнит все пустые `customer.project_groups_ids` из существующих `group.customer` связей
6. **Тестирование:** Добавить тесты для проверки консистентности при всех операциях
