# UX Video Parser: спецификация библиотеки и CLI

- Статус: Draft v1
- Дата: 2026-03-02
- Контекст: на базе `/home/strato-space/copilot/videoparser/specs/ux_video_processing_guide.md`

## 1. Цель и scope

Нужно создать в репозитории `copilot`:
- библиотеку для обработки видео UX-исследований,
- отдельное CLI-приложение для запуска пайплайна из терминала.

Вход:
- видеофайл (screen recording + голосовые комментарии пользователя).

Выход:
- папка со скриншотами:
  - всех экранов (сцены/смены состояния UI),
  - ключевых действий,
- документ с описанием для каждого скриншота (что пользователь делает + контекст комментария).

Ограничения:
- максимальная экономия токенов платных LLM/VLM,
- архитектура должна сразу поддерживать локальные модели на customer-level GPU,
- первая версия (MVP) работает через OpenAI API: `Whisper` + `GPT`.

## 2. Нефункциональные требования

- Надежность:
  - пайплайн должен быть возобновляемым (`--resume`) без повторной оплаты уже обработанных кадров.
- Экономичность:
  - минимизировать число вызовов Vision API через scene detection + дедупликацию.
- Расширяемость:
  - все AI-вызовы через провайдерные интерфейсы (OpenAI/local interchangeable).
- Детерминированность артефактов:
  - стабильные имена файлов, версия формата манифестов.
- Наблюдаемость:
  - метрики по этапам (кадров найдено/отфильтровано, токены, стоимость, ошибки).

## 3. Архитектура решения

## 3.1 Логическая схема

`Video -> Probe -> SceneDetect -> FrameExtract -> Dedupe -> ASR -> Align -> Describe -> Report`

- `Probe`: чтение метаданных видео (длительность, FPS, разрешение).
- `SceneDetect`: поиск смен экранов (все экраны).
- `FrameExtract`: экспорт скриншотов по таймкодам.
- `Dedupe`: удаление почти одинаковых кадров (SSIM/pHash).
- `ASR`: транскрипция комментариев пользователя.
- `Align`: привязка текстовых сегментов к кадрам/сценам.
- `Describe`: описание кадров (экран + действие).
- `Report`: генерация JSON + Markdown документа.

## 3.2 Компоненты

- `videoparser-core` (library):
  - orchestration API,
  - провайдерные интерфейсы,
  - этапы пайплайна,
  - форматы манифестов.
- `videoparser-cli` (executable):
  - команды CLI,
  - чтение конфига,
  - запуск `core` и вывод прогресса.

## 3.3 Рекомендуемая структура в репозитории

```text
copilot/videoparser/
  package.json
  tsconfig.json
  src/
    core/
      pipeline/
      stages/
      providers/
      domain/
      io/
    cli/
      index.ts
      commands/
  prompts/
    describe_batch_v1.txt
    key_action_classifier_v1.txt
  fixtures/
  specs/
    ux_video_processing_guide.md
    ux_video_processing_library_cli_spec.md
```

Примечание: детекция сцен в MVP и далее выполняется через `PySceneDetect` (Python runtime является обязательной зависимостью для этого этапа).

## 4. Data contract (domain model)

## 4.1 Сущности

```ts
export type SceneKind = 'screen_change' | 'key_action' | 'both';

export interface SceneCandidate {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  source: 'pyscenedetect';
  confidence?: number;
}

export interface FrameArtifact {
  id: string;
  sceneId: string;
  timestampSec: number;
  fileName: string;
  filePath: string;
  width: number;
  height: number;
  phash?: string;
  ssimToPrev?: number;
  kind: SceneKind;
}

export interface TranscriptSegment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  confidence?: number;
}

export interface FrameDescription {
  frameId: string;
  screenSummary: string;
  userAction: string;
  keyUiElements: string[];
  userCommentContext: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}
```

## 4.2 Ключевой принцип для требования «все экраны + ключевые действия»

Каждый скриншот получает `kind`:
- `screen_change`: покрытие всех смен экранов,
- `key_action`: отдельный action-момент внутри экрана,
- `both`: совпадение обоих типов.

Итоговый документ обязан содержать все `screen_change` + все `key_action`.

## 5. Стратегия экономии токенов (обязательная)

## 5.1 До LLM (CPU-only фильтры)

1. Scene detection (первичный фильтр):
- `PySceneDetect ContentDetector` (рекомендуемо), стартовые параметры:
  - `threshold: 25` (диапазон 20-27 для UI),
  - `min_scene_len_sec: 2`.

2. Дедупликация кадров:
- `pHash` быстрый фильтр,
- `SSIM` финальный фильтр,
- дефолт: удалять кадр, если `SSIM >= 0.92` к соседнему выбранному.

3. Нормализация изображений:
- масштаб до 1024 px по длинной стороне,
- PNG/JPEG настраиваемо (`jpeg quality 85` для API mode).

## 5.2 Во время LLM вызовов

- Использовать low-detail изображения в OpenAI (`detail: low`).
- Батчировать кадры: 4-6 скриншотов в 1 запрос.
- Требовать структурированный JSON-ответ (минимум лишнего текста).
- Ограничить `max_output_tokens` на пакет.

## 5.3 Кэширование

- Ключ кэша описания кадра: `sha256(image_bytes + prompt_version + model + transcript_context_hash)`.
- Повторный запуск не должен отправлять уже описанные кадры.
- Кэш транскрипции: `sha256(audio_track_bytes + asr_model + language)`.

## 5.4 Бюджетные лимиты (guardrails)

Конфиг должен поддерживать:
- `max_frames_for_vision` (например, 60),
- `max_openai_requests` (например, 20),
- `max_estimated_cost_usd` (hard stop).

При превышении лимита:
- `warn` режим: пропуск low-priority кадров,
- `fail` режим: остановка пайплайна с понятной ошибкой.

## 6. Поддержка локальных моделей (архитектурно, не в MVP)

## 6.1 Провайдерные интерфейсы

```ts
export interface AsrProvider {
  transcribe(audioPath: string, options: AsrOptions): Promise<TranscriptSegment[]>;
}

export interface VisionProvider {
  describeBatch(items: VisionBatchItem[], options: VisionOptions): Promise<FrameDescription[]>;
}
```

## 6.2 Реализации

- MVP:
  - `OpenAIWhisperProvider` (ASR),
  - `OpenAIVisionProvider` (GPT vision).
- Post-MVP:
  - `FasterWhisperProvider` (local GPU),
  - `OllamaVisionProvider` / `QwenVisionProvider`.

Переключение провайдера должно быть только через конфиг/CLI флаг, без изменений pipeline-кода.

## 7. MVP (v1): OpenAI-only

## 7.1 Обязательный функционал

- Входной файл видео (`.mp4/.mov/.mkv/.webm`).
- Извлечение аудио через `ffmpeg`.
- Транскрипция через OpenAI Whisper API.
- Детекция сцен через `PySceneDetect ContentDetector`.
- Экспорт скриншотов всех сцен.
- Дедупликация скриншотов.
- Описание скриншотов через GPT Vision c учетом транскрипционного контекста.
- Генерация Markdown + JSON отчета.

## 7.2 OpenAI модели по умолчанию

- ASR: `whisper-1`.
- Vision description: `gpt-4o-mini`.

(Конкретные модели должны быть параметризуемыми через конфиг.)

## 8. CLI контракт

Бинарь: `uxvp` (рабочее имя)

## 8.1 Команды

1. `uxvp process <videoPath>`
- Полный пайплайн end-to-end.

2. `uxvp detect-scenes <videoPath>`
- Только детекция сцен + экспорт скриншотов.

3. `uxvp transcribe <videoPath>`
- Только ASR и `transcript.json`.

4. `uxvp describe <runDir>`
- Только описание для уже извлеченных скриншотов.

5. `uxvp report <runDir>`
- Перегенерация markdown/json отчета.

## 8.2 Ключевые флаги

- `--out <dir>`: директория запуска.
- `--config <file>`: YAML/JSON конфиг.
- `--resume`: продолжить с последнего успешного этапа.
- `--scene-threshold <num>`.
- `--min-scene-len <sec>`.
- `--max-frames <n>`.
- `--batch-size <n>`.
- `--provider asr=<openai|local> vision=<openai|local>`.
- `--dry-run-cost`: оценка стоимости без вызова Vision API.
- `--json`: машинно-читабельный прогресс-лог.

## 9. Формат выходных артефактов

```text
<out>/<run-id>/
  input/
    source.mp4
  artifacts/
    video_probe.json
    scenes.raw.json
    scenes.filtered.json
    transcript.json
    alignments.json
    descriptions.json
    costs.json
    run_state.json
  screenshots/
    S0001_T000012.340_both.png
    S0002_T000025.900_screen_change.png
    S0003_T000033.120_key_action.png
  report/
    ux_report.md
    ux_report.json
```

## 9.1 `ux_report.json` (обязательный минимум)

```json
{
  "version": "1.0",
  "input_video": "source.mp4",
  "generated_at": "2026-03-02T12:00:00Z",
  "stats": {
    "scenes_detected": 41,
    "frames_after_dedupe": 28,
    "key_actions": 12,
    "openai_requests": 7,
    "estimated_cost_usd": 0.21
  },
  "items": [
    {
      "id": "S0001",
      "kind": "both",
      "timestamp_sec": 12.34,
      "screenshot": "screenshots/S0001_T000012.340_both.png",
      "screen_summary": "Экран авторизации",
      "user_action": "Пользователь вводит email и готовится нажать Continue",
      "key_ui_elements": ["email field", "continue button"],
      "user_comment_context": "Сейчас попробую зайти по рабочей почте"
    }
  ]
}
```

## 9.2 `ux_report.md`

Для каждого элемента:
- timestamp,
- тип (`screen_change/key_action/both`),
- изображение,
- комментарий пользователя,
- описание экрана,
- действие пользователя.

## 10. Детализация этапов пайплайна

## 10.1 Stage A: Video probe

- Получить metadata через `ffprobe`.
- Проверить, что есть видео-поток и (желательно) аудио-поток.
- Сохранить `video_probe.json`.

## 10.2 Stage B: Scene detection

- Использовать `PySceneDetect ContentDetector` как единственный механизм детекции сцен.
- Выгрузить `scenes.raw.json` с confidence/source.

## 10.3 Stage C: Frame extraction + normalization

- Для каждой сцены сохранить как минимум 1 кадр (середина сцены).
- Для длинных сцен (`> N sec`) возможно добавить дополнительные кадры (конфиг).
- Привести размер к target long side.

## 10.4 Stage D: Dedupe

- pHash-группировка рядом стоящих кадров.
- SSIM-порог для финального решения.
- Сохранить `scenes.filtered.json` и карту удаленных дублей.

## 10.5 Stage E: ASR (Whisper)

- Извлечь mono аудио 16kHz wav.
- Отправить в Whisper.
- Сохранить сегменты с таймкодами в `transcript.json`.

## 10.6 Stage F: Alignment

- Для каждого кадра собрать транскрипционный контекст:
  - сегменты внутри сцены,
  - плюс буфер ±2 секунды.
- Сохранить `alignments.json`.

## 10.7 Stage G: Key action detection

- Правило v1 (без лишних токенов):
  - `key_action=true`, если есть сильный action-верб в комментарии и/или резкая UI-смена.
- Опционально GPT-классификатор по тексту (без картинки) для спорных случаев.

## 10.8 Stage H: Vision description

- Батч 4-6 кадров.
- Формат ответа: строгий JSON-массив (один объект на кадр).
- Промпт должен требовать:
  - краткий `screen_summary`,
  - конкретный `user_action`,
  - список `key_ui_elements`.

## 10.9 Stage I: Report assembly

- Сформировать `ux_report.json` как source of truth.
- Сгенерировать `ux_report.md` из JSON.

## 11. Конфигурация

Файл `videoparser.config.yaml`:

```yaml
pipeline:
  resume: true
  max_frames_for_vision: 60
  fail_on_budget_exceed: true

scene_detection:
  mode: pyscenedetect
  detector: content
  pyscenedetect_threshold: 25
  min_scene_len_sec: 2

dedupe:
  enabled: true
  ssim_threshold: 0.92

image:
  long_side_px: 1024
  format: jpeg
  quality: 85

asr:
  provider: openai
  model: whisper-1
  language: ru

vision:
  provider: openai
  model: gpt-4o-mini
  detail: low
  batch_size: 4
  max_output_tokens: 900

budget:
  max_openai_requests: 20
  max_estimated_cost_usd: 1.0
```

## 12. Ошибки, ретраи, идемпотентность

- Ошибки должны иметь codes (`E_VIDEO_INVALID`, `E_FFMPEG_FAILED`, `E_OPENAI_RATE_LIMIT`, ...).
- Ретраи для сетевых OpenAI ошибок:
  - exponential backoff,
  - jitter,
  - лимит попыток.
- Идемпотентность:
  - каждый stage пишет статус в `run_state.json`.
  - при `--resume` stage пропускается, если `status=done` и артефакт валиден.

## 13. Observability

- `costs.json`:
  - запросы по стадиям,
  - токены input/output,
  - estimated cost.
- `metrics.json`:
  - время выполнения стадий,
  - количество кадров до/после фильтрации,
  - доля кадров с пустым transcript context.
- Человеко-читабельный лог + JSONL лог.

## 14. Тестовая стратегия

## 14.1 Unit

- Scene threshold mapper.
- Dedupe logic (pHash/SSIM).
- Alignment logic таймкодов.
- Prompt parser/response validator.

## 14.2 Integration

- Короткий fixture-видео (1-2 мин) с известным expected output.
- Проверка `process --resume`.
- Проверка budget guardrails.

## 14.3 Regression

- Golden `ux_report.json` для 2-3 эталонных видео.
- Допустимые отклонения описаний фиксируются правилами сравнения (не по точному тексту, а по структуре и обязательным полям).

## 15. Критерии приемки MVP

1. Команда `uxvp process <video> --out <dir>` завершается успешно и создает структуру артефактов.
2. В `screenshots/` есть:
- кадры всех обнаруженных экранов,
- кадры, отмеченные как `key_action`.
3. В `report/ux_report.md` и `report/ux_report.json` есть описание для каждого сохраненного скриншота.
4. Есть кэш/резюмирование, повторный запуск не делает лишние OpenAI вызовы.
5. Детекция сцен выполняется через `PySceneDetect` и покрыта smoke/integration тестом.

## 16. План реализации по итерациям

1. Итерация 1: skeleton проекта + `process` + probe + scene detect + frame export.
2. Итерация 2: ASR (Whisper) + alignment + json artifacts.
3. Итерация 3: Vision batch description + markdown/json report.
4. Итерация 4: dedupe + cache + resume + budget guardrails.
5. Итерация 5: local provider adapters (интерфейсы + mock/local implementation path).

## 17. Риски и меры

- Риск: слишком много кадров при низком threshold.
  - Мера: авто-подсказка по threshold + hard cap `max_frames_for_vision`.
- Риск: неточные описания на low-detail.
  - Мера: 2-pass режим (critical frames -> detail=high).
- Риск: нестабильный API latency/rate limit.
  - Мера: очереди батчей + retry policy + resume.
- Риск: отсутствие GPU у клиента для local mode.
  - Мера: локальный mode не обязателен для MVP, но API провайдеры уже абстрагированы.

## 18. Явные решения для старта

- Язык реализации: TypeScript/Node.js.
- Базовые бинарные зависимости: `ffmpeg`/`ffprobe`.
- Scene detection: только `PySceneDetect`.
- ASR v1: OpenAI Whisper.
- Vision v1: OpenAI GPT (`gpt-4o-mini`, `detail=low`, batch=4).
- Формат истины результата: `ux_report.json`, Markdown как проекция.
