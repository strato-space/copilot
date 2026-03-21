# Ambiguous CREATE_TASKS Residual Queue

## Summary

- blocked sessions: `54`
- ontology reading: these are not ordinary missing migrations; they are identity-collision cases where one payload locator points to multiple existing draft tasks
- current rule: do not auto-clear payload unless one human-approved resolution rule per bucket is applied

## Bucket Rules

| Bucket | Session count | Human-approved rule |
|---|---:|---|
| `globalDraft:3:Draft` | `61` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:4:Draft` | `59` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:2:Draft` | `34` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:11:Draft` | `31` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:87:Draft` | `17` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:52:Draft` | `17` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:38:Draft` | `17` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:34:Draft` | `16` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:32:Draft` | `16` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:76:Draft` | `16` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `sessionDraft:2:Draft` | `15` | Prefer the already session-linked Draft tasks; compare payload rows to those current Draft rows, and clear payload only if coverage is exact. |
| `globalDraft:21:Draft` | `14` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:19:Draft` | `14` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:13:Draft` | `14` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:18:Draft` | `13` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:22:Draft` | `13` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:29:Draft` | `13` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:7:Draft` | `12` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:16:Draft` | `11` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:10:Draft` | `11` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:23:Draft` | `10` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:8:Draft` | `9` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `globalDraft:5:Draft` | `6` | Re-read the session transcript, regenerate via the standard create_tasks code path, compare regenerated rows against existing global Draft tasks in the same project/topic, and only then either link to the existing task or split into a new one. |
| `sessionDraft:3:Draft` | `4` | Prefer the already session-linked Draft tasks; compare payload rows to those current Draft rows, and clear payload only if coverage is exact. |

## Session Queue

| Session ID | Session Name | Project ID | Blocked Items | Pattern Samples |
|---|---|---|---:|---|
| `699e823570e6008285f90106` | Комменты по мейдике | `698af98806b3a6762286b867` | `15` | `globalDraft:7:Draft; globalDraft:5:Draft; globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft` |
| `69a1524f8bd9d61756043592` | Оптимизация договоров и стратегии продаж в IT-проектах | `` | `15` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `6996ae012835b2811da9b9ca` | Morning Sessions - Bugs / Stabilisation | `6875e887c5f43ce3d205e7c6` | `13` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `69942fc3f4275d74287986db` | Мобильное приложение: Обсуждение сценариев регистрации и активации сим-карты | `6729d23834e1aad47395f941` | `12` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft; globalDraft:18:Draft; globalDraft:16:Draft` |
| `69944cf9f4275d7428798716` | UX-дизайн: обзор макетов и приоритетов задач | `6729d23834e1aad47395f941` | `12` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft; globalDraft:18:Draft; globalDraft:16:Draft` |
| `699573005d85620dd7ebb434` | LikeAuto: продуктовый редизайн платформы и UX-фокус | `6729d23834e1aad47395f941` | `12` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft; globalDraft:18:Draft; globalDraft:16:Draft` |
| `699e7de070e6008285f900f0` | Morning Session | `672315cb537994d86e1c68ae` | `12` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft` |
| `69a11c953d4b4ccb9eb4de3b` | Оптимизация договорных отношений и рост прибыльности проектов | `69a1746a4f5005997ece8ebf` | `12` | `globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft; globalDraft:32:Draft; globalDraft:29:Draft` |
| `69a50eb64b07162c36957e08` | UX-аудит: методология и последовательность шагов проведения | `6729d23834e1aad47395f941` | `12` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft; globalDraft:18:Draft; globalDraft:16:Draft` |
| `69a686e17f377b054f83d41b` | Design Status | `672315cb537994d86e1c68ae` | `12` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft` |
| `69b296d2b8f72e772e8e2d34` | LikeAuto: Редизайн фотоотчетов и витрины: согласование объема и сроков | `69b39e38b00ed62d0c449fdd` | `12` | `sessionDraft:3:Draft; sessionDraft:2:Draft` |
| `69a7cb2002566a3e76d2dc11` | Morning Session | Операционные дела, Доходы | Dev сессия Антон + ВП | `6875e887c5f43ce3d205e7c6` | `11` | `globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft; globalDraft:10:Draft; globalDraft:7:Draft` |
| `69aa59158863fc916ec11e80` | Апрельский план: коннекты и запуск продаж | `` | `11` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `6996dacdff0189e621a4cc13` | Test Session | `` | `10` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `699ec60739cbeaee2a40c8c7` | FigmaBoy 1 | `6875e887c5f43ce3d205e7c6` | `10` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `699ff10961cc6cc00840480c` | FigmaBoy 4 | `6875e887c5f43ce3d205e7c6` | `10` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `69a153fd4f5005997ece8ead` | UX/UI обсуждение: улучшение функционала поиска и замены товаров | `6996a18106b3a6762286b8ae` | `10` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `69a67b907f377b054f83d3f4` | Mornig Session 2 - Обогащение отчетов, Извлечение коммункации с дизайнерами, подключение Figma Index  | `6875e887c5f43ce3d205e7c6` | `10` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `69a91c374572b3db568b9a94` | MPick process problems and fixes | `698c0bd106b3a6762286b86b` | `10` | `globalDraft:3:Draft; globalDraft:2:Draft` |
| `69aa52638863fc916ec11e79` | Финансовое планирование марта: падение выручки и апсейл | `` | `10` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `69aa6de08863fc916ec11e90` | 2025-03-06 Morning Session | Управление задачами, профайлинг типов контактов, контекст проекта, нарезка video на voice и figma | `6875e887c5f43ce3d205e7c6` | `10` | `globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft; globalDraft:10:Draft` |
| `699822d31da4fda3b24b988c` | Продуктовый чат: разработка адаптивного интерфейса и задач | `698ac7a306b3a6762286b851` | `9` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `699d89ce28485be3601661d7` | Reverse макетов | `672315cb537994d86e1c68ae` | `9` | `globalDraft:4:Draft; globalDraft:3:Draft` |
| `69aa85648863fc916ec11eb5` | Обсуждение стиля для strato.space | `6729d23834e1aad47395f941` | `9` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft; globalDraft:18:Draft; globalDraft:16:Draft` |
| `6995810a9bce3264e9851b87` | MediaGen Demo | `698af98806b3a6762286b867` | `8` | `globalDraft:7:Draft; globalDraft:5:Draft; globalDraft:4:Draft; globalDraft:3:Draft` |
| `699d3efec978d2bf5de4bc53` | Morning Session | `6875e887c5f43ce3d205e7c6` | `8` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `699fe1b461cc6cc0084047ed` | FigmaBoy 3 / MPick | `6875e887c5f43ce3d205e7c6` | `8` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `69a16eab8bd9d617560435b6` | Крипто-маркетинг и автоматизация контент-продакшена: стратегия развития | `` | `8` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `69a6ced826d804a033270036` | 10 min | Desomposition | BD Issues | Послойный модульный дизайн | Оркестрация подагентов для эффективной разбивки UI-задач с учетом контекста и ролей | `6875e887c5f43ce3d205e7c6` | `8` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `69aa7d888863fc916ec11eaa` | Будущее дизайн-систем: контекстный UX и dark patterns | `` | `8` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `6992ec2df4275d74287986af` | Mshop: Вводная встреча | `6729d23834e1aad47395f941` | `7` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft` |
| `699581c4da91e7554bf6a62e` | Дизайн-проект: Согласование сроков и комментариев | `6729d23834e1aad47395f941` | `7` | `globalDraft:4:Draft; globalDraft:3:Draft; globalDraft:2:Draft` |
| `699fc77f61cc6cc0084047e1` | Медиаконтент и коммуникации: оптимизация производства и автоматизация | `` | `7` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `69a147984f5005997ece8e96` | FigmaBoy 5 + MPick | `6875e887c5f43ce3d205e7c6` | `7` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `69a150808bd9d6175604358d` | Креативный кластер Академпарка: запуск и опыт акселератора «Астарт» | `` | `7` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `69a1856b8bd9d617560435cf` | Автоматизация медиапайплайна: обсуждение и планирование | `` | `7` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `69a3ed484b07162c36957dee` | BD | Codex Swarm | `6875e887c5f43ce3d205e7c6` | `7` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `69a9718e8863fc916ec11e6e` | Оптимизация обработки сессий: транскрипты и скриншоты для Figma | `` | `7` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `69b3a788b8f72e772e8e2d57` | DefFigma: Дистилляция и стандарты документации | `6875e887c5f43ce3d205e7c6` | `7` | `sessionDraft:2:Draft` |
| `699837ffec03493fba1a735d` | Status T2 | `698ad04506b3a6762286b859` | `6` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `699e793070e6008285f900e4` | Идеи по figma mcp и приему задач из чатов | `6875e887c5f43ce3d205e7c6` | `6` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft; globalDraft:11:Draft` |
| `69a57c681c018d01aa12c172` | Infomedia: sobers call 2 - design manager | `6729d23834e1aad47395f941` | `6` | `globalDraft:4:Draft; globalDraft:3:Draft` |
| `69a8143d4572b3db568b9a79` | MediaGen - настроить VPN для gpt моделей, повесить парольную аутентификацию | `698af98806b3a6762286b867` | `6` | `globalDraft:7:Draft; globalDraft:5:Draft; globalDraft:4:Draft; globalDraft:3:Draft` |
| `69aaa5b6bb4114f74964dab4` | Редизайн: согласование договора и модели оплаты | `` | `6` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft` |
| `6996d9169bce3264e9851c1c` | WebRTC с Никитой | `6875e866c5f43ce3d205e7c4` | `5` | `globalDraft:87:Draft; globalDraft:52:Draft; globalDraft:38:Draft; globalDraft:34:Draft; globalDraft:32:Draft` |
| `69a82c204572b3db568b9a85` | MPick Troubles | `698c0bd106b3a6762286b86b` | `5` | `globalDraft:3:Draft; globalDraft:2:Draft` |
| `69a3e0fe4b07162c36957dad` | Голосовые команды и интеграция ИИ в рабочие процессы | `6875e887c5f43ce3d205e7c6` | `4` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft` |
| `69a51d4b4b07162c36957e15` | UX анализ оформления заказа в BurgerKing и Ростикс | `6729d23834e1aad47395f941` | `4` | `globalDraft:4:Draft; globalDraft:3:Draft` |
| `69a6d9cf26d804a03327004d` | Internal | `6875e887c5f43ce3d205e7c6` | `4` | `globalDraft:22:Draft; globalDraft:21:Draft; globalDraft:19:Draft; globalDraft:13:Draft` |
| `69a6f90d1c018d01aa12c183` | Бюджет и переход на фуллтайм с обсуждением ограничений платформы | `` | `4` | `globalDraft:87:Draft; globalDraft:76:Draft; globalDraft:52:Draft; globalDraft:38:Draft` |
| `69982f411da4fda3b24b9895` | UI дизайн: обсуждение вариантов градиентов и плашек | `6865fae618fb3e43aafbc29a` | `2` | `globalDraft:23:Draft; globalDraft:18:Draft` |
| `69a18ae78bd9d617560435d9` | Работа с аудио и дизайн: оценки и ожидания пользователя | `` | `2` | `globalDraft:87:Draft; globalDraft:76:Draft` |
| `69a24e4605c9941fabcd3e2f` | copilot bugs | `6875e887c5f43ce3d205e7c6` | `2` | `globalDraft:22:Draft; globalDraft:21:Draft` |
| `69b8ee938a877bdbe0263879` | Morning Session. Медиаген: приоритизация офферов и продаж | `672315cb537994d86e1c68ae` | `2` | `globalDraft:4:Draft; globalDraft:3:Draft` |
