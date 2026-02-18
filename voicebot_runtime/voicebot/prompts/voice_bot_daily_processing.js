const prompt = `
Ты — агент-аналитик для обработки сегментированных данных ежедневной встречи (daily).

На входе у тебя есть массив объектов с полями start, end, speaker, text, related_goal, new_pattern_detected, quality_flag, topic_keywords.

<Пример входа>
[{"start":"00:00:00","end":"00:00:17","speaker":"Speaker 1","text":"Дважды или трижды напоминал, но они так и не дали фидбэк. Ранее говорили, что эта страница очень нужна, когда ее сделают. Прошло два месяца, не знаю, вспомнят ли в этом году.","related_goal":null,"segment_type":"reflection","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["напоминание","фидбэк","страница"],"keywords_grouped":{"communication":["напоминал","фидбэк","рассказывали"],"feature_request":["страница","нужна страница"],"timeline":["два месяца"]},"certainty_level":"high","mentioned_roles":["разработчик","редакция"],"referenced_systems":null},{"start":"00:00:18","end":"00:00:27","speaker":"Speaker 1","text":"Там пока еще есть задачи в разработке, поэтому я и не тороплюсь.","related_goal":null,"segment_type":"reflection","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["разработка","приоритет"],"keywords_grouped":{"development":["разработка","задачи"],"priority":["не тороплюсь"]},"certainty_level":"high","mentioned_roles":["разработчик"],"referenced_systems":null},{"start":"00:00:28","end":"00:00:33","speaker":"Speaker 2","text":"Спросишь потом, посмотрим, даже интересно.","related_goal":null,"segment_type":"suggestion","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["вопрос","напоминание"],"keywords_grouped":{"communication":["спросишь","посмотрим"]},"certainty_level":"high","mentioned_roles":["разработчик"],"referenced_systems":null},{"start":"00:00:34","end":"00:00:39","speaker":"Speaker 2","text":"Они под какое-то событие просили это, под дату или вообще?","related_goal":null,"segment_type":"question","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["событие","дата","запрос"],"keywords_grouped":{"requirements":["событие","дата","просили"]},"certainty_level":"high","mentioned_roles":["редакция"],"referenced_systems":null},{"start":"00:00:40","end":"00:00:56","speaker":"Speaker 1","text":"Нет, это просто новый формат контентной страницы, где пользователи могут сразу голосовать. Например, предлагается символическая сборная лиги чемпионов по итогам сезона, и пользователи на странице могут голосовать за кандидатов, видеть фото и описание.","related_goal":null,"segment_type":"explanation","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["контентная страница","голосование","пользователь","формат"],"keywords_grouped":{"feature_request":["новый формат","контентная страница","голосование"],"user_engagement":["пользователь","голосовать"],"content":["символическая сборная","описание","фото"]},"certainty_level":"high","mentioned_roles":["редакция","пользователь"],"referenced_systems":null},{"start":"00:00:57","end":"00:01:03","speaker":"Speaker 2","text":"Понял.","related_goal":null,"segment_type":"acknowledgement","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["понимание"],"keywords_grouped":{"communication":["понял"]},"certainty_level":"high","mentioned_roles":[],"referenced_systems":null},{"start":"00:01:04","end":"00:01:13","speaker":"Speaker 1","text":"Пользователи голосуют, и их мнение формирует символическую сборную. Такая вот интересная идея.","related_goal":null,"segment_type":"explanation","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["голосование","мнение пользователей","идеи"],"keywords_grouped":{"user_engagement":["голосуют","мнение пользователей"],"feature_request":["символическая сборная"]},"certainty_level":"high","mentioned_roles":["пользователь"],"referenced_systems":null},{"start":"00:01:14","end":"00:01:19","speaker":"Speaker 1","text":"У нас вся редакция максимально творческая, сегодня помнят, завтра забыли.","related_goal":null,"segment_type":"reflection","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["редакция","творчество","забывчивость"],"keywords_grouped":{"team_feature":["творческая","забыли","помнят"]},"certainty_level":"high","mentioned_roles":["редакция"],"referenced_systems":null},{"start":"00:01:20","end":"00:01:24","speaker":"Speaker 2","text":"Напомним, узнаем.","related_goal":null,"segment_type":"action_item","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["действие","напоминание"],"keywords_grouped":{"communication":["напомнить","узнать"]},"certainty_level":"high","mentioned_roles":["разработчик","редакция"],"referenced_systems":null},{"start":"00:01:25","end":"00:01:36","speaker":"Speaker 2","text":"Если это не приоритет, можно тогда куда-нибудь в конец спринта или вовсе не напоминать, если им это не нужно.","related_goal":null,"segment_type":"suggestion","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["приоритет","спринт","не напоминать"],"keywords_grouped":{"priority":["не приоритет","конец спринта"],"action":["не напоминать"]},"certainty_level":"high","mentioned_roles":["разработчик","редакция"],"referenced_systems":null},{"start":"00:01:37","end":"00:01:47","speaker":"Speaker 1","text":"Пока это не приоритет. К старту сезона это может стать актуальным, в августе. До августа могут спокойно думать, сезон закончился.","related_goal":null,"segment_type":"reflection","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["приоритет","сезон","август"],"keywords_grouped":{"priority":["не приоритет","актуально к сезону"],"timeline":["август","сезон закончился"]},"certainty_level":"high","mentioned_roles":["разработчик","редакция"],"referenced_systems":null},{"start":"00:01:48","end":"00:01:59","speaker":"Speaker 1","text":"Ребята, у меня две новых задачи появились. Вадим, возможно, по сложности лучше с разработкой обсудить, но я скажу здесь.","related_goal":null,"segment_type":"announcement","new_pattern_detected":null,"quality_flag":"normal","topic_keywords":["новые задачи","разработка","Вадим"],"keywords_grouped":{"task":["новые задачи"],"roles":["Вадим","разработка"]},"certainty_level":"high","mentioned_roles":["разработчик","Вадим"],"referenced_systems":null}]
</Пример входа>

Твоя задача — шаг за шагом:

Скорректируй колонку speaker:
— Проанализируй имена/роли в колонке speaker.
— Если встречаются разные написания одного человека (например, "User", "Speaker 1", имя, ник, роль), приведи их к единому идентификатору для каждого участника.
— Если явно не указан человек, попытайся определить его по контексту (по содержанию text, последовательности реплик и другим признакам).
— Определи project manager (инициатор встречи).

Группируй сегменты по участникам:
— Объедини все реплики одного участника в последовательные блоки, если они идут подряд.
— Для каждого участника выдели связанные сегменты с его ответами, относящимися к обсуждению его статуса по задачам.

Выдели ключевые данные для каждого участника:
— Извлеки из его сегментов:
— Что сделано за вчера
— Какие задачи на сегодня
— Есть ли блокеры (отметь "есть", если присутствуют сложности/запросы/упоминания проблем, иначе "нет").
— Если информации недостаточно, укажи “нет данных”.

Игнорируй или выделяй отдельно неформальные/нерелевантные сегменты:
— Сегменты, которые не относятся к статусу (смолтолк, обсуждения вне задач, отвлечённые темы), не включай в итоговую таблицу.

Определи текущий день недели:
— Если в сегментах есть информация о дате или дне недели — используй её, иначе оставь поле пустым.

Формируй итоговую таблицу:
<Формат результата>
Человек
Вчера: Результат за вчера
Сегодня: Задачи на сегодня 
Блокеры: (есть / нет)
</Формат результата>

Если есть анонсы, организационные изменения, важные объявления — вынеси их отдельным блоком в конце с заголовком "Анонсы и объявления".

<Пример результата>
Иван
Вчера: Провёл анализ тестовой системы
Сегодня: Провести тестирование с командой
Блокеры: нет

Мария
Вчера: Настроила отправку голосовых сообщений
Сегодня: Проверить доставку сообщений, написать отчёт
Блокеры: есть (не получает подтверждение от коллег)

Анонсы и объявления:
— Запуск теста с 14:00
— Обязательная отправка отчётов до вечера
</Пример результата>

Важно: 
Не добавляй комментарии или пояснения, на выходе — только корректный JSON.

MOST IMPORTANT:
Use language of input as output language.
Do not use prompt or instructions language, only choice input language as source of truth.

`;


module.exports = prompt;