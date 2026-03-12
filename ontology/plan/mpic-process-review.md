Основных проблем было **четыре**.

**1. Методология описывала артефакты как одну линейную цепочку, хотя реально это граф проекций**
Было:
`CJM -> BPMN -> User flow -> Screen -> Widget -> Atom -> Token`

Проблема:
это выглядит красиво, но онтологически неверно.
`ERD`, `CJM`, `BPMN`, `User Flow`, `Screen Contracts`, `Context Cards`, `Trace Registries` не стоят в одной “лесенке”.
Они являются разными представлениями и связующими слоями.

Почему это плохо:
- появляется ложная модель зависимости;
- трассировка начинает врать;
- сложно понять, что из чего реально должно выводиться, а что просто связано.

Как чинится:
- заменить “одну цепочку” на **layered artifact graph**;
- явно различить:
  `normalizes-from`,
  `projects-from`,
  `depends-on`,
  `contracts-with`,
  `traces-to`,
  `binds-to`,
  `gated-by`.

---

**2. Сырой вход был недостаточно структурирован для генерации**
Было:
интервью, скриншоты, raw docs считались почти непосредственным входом в `CJM/BPMN/User Flow/Screen`.

Проблема:
во входе были смешаны:
- факты,
- цели,
- роли,
- ограничения,
- pain-points,
- assumptions,
- open questions,
- visual observations.

Почему это плохо:
генерация шла частично “на догадке”, а не на нормализованной семантике.

Как чинится:
- ввести обязательный слой
  `Input Evidence Packet`
  и
  `Source Normalization Registry`
- запретить строить `CJM/BPMN/User Flow/Screen` напрямую из сырых интервью/скриншотов;
- сначала нормализовать вход в typed semantic fragments.

---

**3. Типизация нормализованного входа была слишком грубой**
Было:
одно поле `semantic_class`, куда складывались и domain-объекты, и evidence observations, и epistemic items.

Проблема:
в одном списке оказывались сущности разных родов.
Например:
`role`, `goal`, `constraint`, `visual_observation`, `assumption`, `open_question`.

Почему это плохо:
- downstream-артефакты начинают путать planes;
- невозможно стабильно автоматизировать преобразования;
- evidence и business semantics текут друг в друга.

Как чинится:
- заменить плоский `semantic_class` на:
  - `content_plane`
  - `semantic_kind`
  - `assertion_status`
- развести хотя бы 4 planes:
  `domain`, `epistemic`, `evidence`, `governance`

---

**4. `source-of-truth` использовался в нескольких смыслах сразу**
Было:
одним и тем же словом обозначались:
- сырой вход,
- `CJM`,
- `bd`

Проблема:
не было понятно, кто за что authoritative:
- evidence,
- business semantics,
- task execution/gates.

Почему это плохо:
- `bd` мог начать восприниматься как authority по смыслу;
- `CJM` — как authority по raw evidence;
- изменения upstream-evidence было трудно правильно распространять вниз.

Как чинится:
- ввести явную **authority model**:
  - `Input Evidence Authority`
  - `Semantic/Core Authority`
  - `Business Modeling Authority`
  - `UI Realization Authority`
  - `Execution/Gate Authority`
- перестать использовать `source-of-truth` без указания слоя.

---

**Что еще было вторичным, но важным**

**5. Фазовая модель смешивалась с онтологией артефактов**
Было:
phase order и artifact structure частично описывались как одно и то же.

Почему это плохо:
порядок работ начинал подменять смысловую архитектуру.

Как чинится:
- отделить `artifact graph` от `phase model`;
- прямо записать, что phase model — это **порядок работ**, а не онтология артефактов.

---

**6. Не были явны generation preconditions**
Было:
не было жесткого правила, при каких upstream-артефактах вообще можно строить `Screen` и `Widget`.

Почему это плохо:
экраны и виджеты можно было собирать раньше, чем стабилизированы `CJM`, `User Flow`, `BPMN`, contracts.

Как чинится:
- ввести `Generation Preconditions` для `Screen` и `Widget`;
- например, `Screen` можно строить только если есть:
  `CJM`, `User Flow`, `BPMN fragment`, `Screen Context Card`, `Screen Contracts`, trace links.

---

**7. Не было формализованного change-impact rule**
Было:
если меняется интервью, `CJM`, `ERD`, `BPMN` или contracts, не было явно сказано, что именно надо перепроверять.

Почему это плохо:
изменения легко расползаются silently.

Как чинится:
- добавить `Change Impact Rule`:
  какой upstream change инвалидирует какие downstream-слои.

---

**Итог**
Главные дефекты были не в том, что “не хватает еще одного артефакта”, а в том, что методология была:

- слишком линейной там, где нужен граф,
- слишком слабой в типизации входа,
- слишком расплывчатой в authority boundaries,
- слишком неявной в правилах сборки и пересборки.

**Как они теперь чинятся в принципе**
Вся починка сводится к одному общему принципу:

> не генерировать UI прямо из сырого входа,  
> а сначала строить типизированное semantic core,  
> затем получать parallel projections,  
> затем связывать их bridges/contracts,  
> и только после этого собирать UI.

