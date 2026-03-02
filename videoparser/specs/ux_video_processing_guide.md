# Обработка видео UX-исследований: полное руководство

> Цель: автоматическая нарезка скриншотов ключевых действий и всех экранов из видео UX-исследования с описанием того, что пользователь делает.

---

## Оглавление

- [1. Общая архитектура пайплайна](#1-общая-архитектура-пайплайна)
- [2. Извлечение кадров и предобработка (FFmpeg)](#2-извлечение-кадров-и-предобработка-ffmpeg)
- [3. PySceneDetect — детекция смены экранов](#3-pyscenedetect--детекция-смены-экранов)
  - [3.1 Что это такое](#31-что-это-такое)
  - [3.2 Зачем в UX-пайплайне](#32-зачем-в-ux-пайплайне)
  - [3.3 Детекторы и какой выбрать](#33-детекторы-и-какой-выбрать)
  - [3.4 Установка](#34-установка)
  - [3.5 Использование через CLI](#35-использование-через-cli)
  - [3.6 Использование через Python API](#36-использование-через-python-api)
  - [3.7 Подбор порога threshold](#37-подбор-порога-threshold)
  - [3.8 PySceneDetect vs FFmpeg scene фильтр](#38-pyscenedetect-vs-ffmpeg-scene-фильтр)
- [4. Продвинутая детекция смены экранов (Python SSIM)](#4-продвинутая-детекция-смены-экранов-python-ssim)
- [5. Транскрипция аудио (комментарии пользователя)](#5-транскрипция-аудио-комментарии-пользователя)
  - [5.1 Whisper (локально)](#51-whisper-локально)
  - [5.2 faster-whisper (оптимизированный)](#52-faster-whisper-оптимизированный)
- [6. Описание скриншотов (Vision LLM)](#6-описание-скриншотов-vision-llm)
  - [6.1 Стратегия экономии токенов](#61-стратегия-экономии-токенов)
  - [6.2 Локальная VLM (бесплатно)](#62-локальная-vlm-бесплатно)
  - [6.3 Ollama (проще в установке)](#63-ollama-проще-в-установке)
  - [6.4 Облачные API (лучшее качество)](#64-облачные-api-лучшее-качество)
- [7. Полный пайплайн — всё вместе](#7-полный-пайплайн--всё-вместе)
- [8. Полная интеграция PySceneDetect в пайплайн](#8-полная-интеграция-pyscenedetect-в-пайплайн)
- [9. Сводная таблица решений](#9-сводная-таблица-решений)
- [10. Рекомендации: оптимальный стек](#10-рекомендации-оптимальный-стек)
- [11. Схема места PySceneDetect в пайплайне](#11-схема-места-pyscenedetect-в-пайплайне)

---

## 1. Общая архитектура пайплайна

```
Видео → FFmpeg (нарезка/кадры) → Детекция смены экранов → Скриншоты ключевых моментов → Описание (LLM/VLM) → Отчёт
```

---

## 2. Извлечение кадров и предобработка (FFmpeg)

FFmpeg — ключевой инструмент для экономии токенов: чем лучше предобработка, тем меньше кадров уходит в нейросеть.

### Базовое извлечение кадров

```bash
# Извлечь 1 кадр в секунду (грубая нарезка)
ffmpeg -i ux_session.mp4 -vf "fps=1" frames/frame_%04d.png

# Извлечь 1 кадр каждые 5 секунд (экономнее)
ffmpeg -i ux_session.mp4 -vf "fps=1/5" frames/frame_%04d.png
```

### Детекция смены сцен (самое важное для экономии!)

```bash
# FFmpeg scene detection — извлекает кадры только при смене экрана
# threshold 0.3–0.4 хорошо работает для UI (резкие переходы)
ffmpeg -i ux_session.mp4 -vf "select='gt(scene,0.3)',showinfo" \
  -vsync vfn frames/scene_%04d.png 2>&1 | grep showinfo

# С временными метками для каждого кадра
ffmpeg -i ux_session.mp4 -vf "select='gt(scene,0.3)',metadata=print:file=timestamps.txt" \
  -vsync vfn frames/scene_%04d.png
```

### Извлечение аудио (для транскрипции комментариев)

```bash
# Извлечь аудиодорожку
ffmpeg -i ux_session.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 audio.wav

# Нарезать аудио на сегменты по 30 секунд (для batch-обработки)
ffmpeg -i audio.wav -f segment -segment_time 30 -c copy segments/chunk_%03d.wav
```

---

## 3. PySceneDetect — детекция смены экранов

### 3.1 Что это такое

**PySceneDetect** — open-source Python-библиотека (текущая версия **v0.6.7.1**) для автоматического обнаружения смены сцен в видео. Работает и как CLI-утилита, и как Python API.

- Репозиторий: [Breakthrough/PySceneDetect](https://github.com/Breakthrough/PySceneDetect)
- Документация: [scenedetect.com/docs/latest](https://www.scenedetect.com/docs/latest/)
- PyPI: [pypi.org/project/scenedetect](https://pypi.org/project/scenedetect/)

Ключевое: библиотека работает **только на CPU**, не требует GPU, и при этом обрабатывает видео быстро — это чисто алгоритмическая обработка кадров без нейросетей.

### 3.2 Зачем в UX-пайплайне

Главная проблема при обработке видео UX-исследования — **отсечь неинформативные кадры**. В 30-минутном видео при 30 fps — это 54 000 кадров. Отправлять все в VLM невозможно и бессмысленно. PySceneDetect решает задачу:

```
54 000 кадров → PySceneDetect → 20–50 ключевых моментов смены экрана
```

Это **главный фильтр** в пайплайне, который определяет, сколько вы потратите на описание через нейросеть.

### 3.3 Детекторы и какой выбрать

PySceneDetect предлагает 5 алгоритмов детекции. Для записей экрана UX-исследований они подходят по-разному:

| Детектор | Принцип | Для UX-видео | Когда использовать |
|----------|---------|--------------|-------------------|
| **ContentDetector** | Сравнение HSV-разницы между соседними кадрами | ★★★★★ | **Основной выбор.** Экраны приложений меняются резко — идеально для content detection |
| **AdaptiveDetector** | Скользящее среднее разницы кадров | ★★★★☆ | Если в записи есть анимации/переходы, которые дают ложные срабатывания |
| **ThresholdDetector** | Порог яркости кадра | ★★☆☆☆ | Только если есть fade-in/fade-out переходы |
| **HistogramDetector** | Гистограмма яркости (Y-канал YCbCr) | ★★★☆☆ | Если яркость экрана сильно меняется (тёмная/светлая тема) |
| **HashDetector** | Перцептуальный хеш изображения | ★★★☆☆ | Быстрый, но менее точный |

**Рекомендация:** для типичного UX-видео (запись экрана приложения) — **ContentDetector** с порогом `threshold=27` как стартовая точка.

### 3.4 Установка

```bash
# Базовая установка (только детекция)
pip install scenedetect[opencv]

# Полная установка (детекция + нарезка видео через ffmpeg)
pip install scenedetect[opencv]
# + ffmpeg должен быть установлен в системе
```

### 3.5 Использование через CLI

#### Быстрый старт — найти все смены экрана

```bash
# Детекция сцен с сохранением скриншотов
scenedetect -i ux_session.mp4 \
  detect-content -t 27 \
  save-images \
  list-scenes
```

Эта команда:
1. Анализирует видео
2. Находит все моменты смены экрана
3. Сохраняет скриншоты начала/середины/конца каждой сцены
4. Выводит список сцен с временными метками

#### Расширенные опции для UX-видео

```bash
# Более тонкая настройка:
# -t 20 — ниже порог = больше детекций (ловим мелкие изменения UI)
# --min-scene-len 2s — минимальная длина сцены 2 секунды (фильтрует мерцания)
scenedetect -i ux_session.mp4 \
  detect-content -t 20 --min-scene-len 2s \
  save-images --num-images 1 \
  list-scenes -o scenes.csv

# AdaptiveDetector — если ContentDetector даёт слишком много ложных срабатываний
scenedetect -i ux_session.mp4 \
  detect-adaptive --min-scene-len 3s \
  save-images --num-images 1

# Нарезка видео на отдельные файлы по сценам
scenedetect -i ux_session.mp4 \
  detect-content -t 27 \
  split-video
```

#### Что получаем на выходе CLI

```
output/
├── ux_session-Scenes.csv          # Таблица: номер сцены, начало, конец, длительность
├── ux_session-Scene-001-01.jpg    # Скриншот сцены 1
├── ux_session-Scene-002-01.jpg    # Скриншот сцены 2
├── ux_session-Scene-003-01.jpg    # ...
└── ...
```

CSV-файл содержит:

```csv
Scene Number,Start Frame,Start Timecode,Start Time (seconds),End Frame,End Timecode,End Time (seconds),Length (frames),Length (timecode),Length (seconds)
1,0,00:00:00.000,0.000,847,00:00:28.233,28.233,847,00:00:28.233,28.233
2,847,00:00:28.233,28.233,1293,00:00:43.100,43.100,446,00:00:14.867,14.867
3,1293,00:00:43.100,43.100,2105,00:01:10.167,70.167,812,00:00:27.067,27.067
```

### 3.6 Использование через Python API

#### Базовый пример

```python
from scenedetect import detect, ContentDetector

# Одна строка — получить список всех смен сцен
scene_list = detect("ux_session.mp4", ContentDetector(threshold=27))

for i, scene in enumerate(scene_list):
    start_time = scene[0].get_seconds()
    end_time = scene[1].get_seconds()
    print(f"Сцена {i+1}: {start_time:.1f}s — {end_time:.1f}s "
          f"(длительность: {end_time - start_time:.1f}s)")
```

### 3.7 Подбор порога threshold

Порог — самый важный параметр. Его нужно подбирать под конкретное видео:

```python
"""
Скрипт для подбора оптимального порога.
Запускает детекцию с разными значениями и показывает количество сцен.
"""
from scenedetect import detect, ContentDetector

video = "ux_session.mp4"

print("Threshold | Scenes found")
print("----------|-------------")
for t in [15, 20, 25, 27, 30, 35, 40, 50]:
    scenes = detect(video, ContentDetector(threshold=t))
    print(f"    {t:>3}   |     {len(scenes)}")
```

Типичный выход:

```
Threshold | Scenes found
----------|-------------
     15   |     87       ← слишком много, ловит микро-изменения
     20   |     52       ← может быть много, но ничего не пропускает
     25   |     34       ← хороший баланс для UI
     27   |     28       ← дефолт, обычно хорошо работает
     30   |     21       ← консервативно
     35   |     14       ← может пропустить мелкие переходы
     40   |      9       ← только крупные смены экранов
     50   |      5       ← слишком грубо
```

**Для UX-видео рекомендуется `threshold=20–27`** — UI-переходы обычно резкие (новый экран = большое изменение), но мелкие действия (раскрытие меню, появление клавиатуры) могут быть менее контрастными.

### 3.8 PySceneDetect vs FFmpeg scene фильтр

| Критерий | FFmpeg `select=gt(scene,X)` | PySceneDetect |
|----------|---------------------------|---------------|
| Алгоритмы | 1 (разница кадров) | 5 (content, adaptive, threshold, histogram, hash) |
| Минимальная длина сцены | Нужно скриптовать вручную | Встроенный параметр `min_scene_len` |
| Подбор порога | Trial & error | Можно программно перебрать |
| CSV/JSON экспорт | Нет | Встроенный |
| Flash-фильтр | Нет | Есть (убирает ложные срабатывания от вспышек) |
| Python API | Нет | Полноценный, легко интегрируется в пайплайн |
| Адаптивная детекция | Нет | AdaptiveDetector со скользящим средним |

---

## 4. Продвинутая детекция смены экранов (Python SSIM)

FFmpeg scene detection ловит не всё — UI-переходы бывают плавными. Дополняем:

```python
"""
Комбинированная детекция смены экранов:
- structural similarity (SSIM) между соседними кадрами
- гистограммное сравнение
- порог минимального интервала (не чаще 1 кадра в 2 сек)
"""
import cv2
import numpy as np
from skimage.metrics import structural_similarity as ssim
from pathlib import Path

def extract_key_frames(video_path, output_dir,
                       ssim_threshold=0.85,
                       min_interval_sec=2.0):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    min_interval_frames = int(fps * min_interval_sec)

    prev_gray = None
    frame_idx = 0
    last_saved = -min_interval_frames
    key_frames = []

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # Уменьшаем для быстрого сравнения
        gray_small = cv2.resize(gray, (320, 240))

        if prev_gray is not None:
            score = ssim(prev_gray, gray_small)

            if score < ssim_threshold and (frame_idx - last_saved) >= min_interval_frames:
                timestamp = frame_idx / fps
                filename = f"key_{len(key_frames):04d}_{timestamp:.1f}s.png"
                cv2.imwrite(f"{output_dir}/{filename}", frame)
                key_frames.append({
                    "frame": frame_idx,
                    "timestamp": timestamp,
                    "ssim_delta": score,
                    "file": filename
                })
                last_saved = frame_idx

        prev_gray = gray_small
        frame_idx += 1

    cap.release()

    # Всегда сохраняем первый и последний кадры
    # (добавить логику по необходимости)

    print(f"Извлечено {len(key_frames)} ключевых кадров из {frame_idx} всего")
    return key_frames

if __name__ == "__main__":
    frames = extract_key_frames("ux_session.mp4", "key_frames/")
```

Также есть готовая библиотека **PySceneDetect** (быстрый CLI-вызов):

```bash
pip install scenedetect[opencv]

# Автоматическая нарезка по сценам
scenedetect -i ux_session.mp4 detect-content -t 27 save-images
```

---

## 5. Транскрипция аудио (комментарии пользователя)

### 5.1 Whisper (локально)

```bash
pip install openai-whisper

# Модели: tiny (39M) → base (74M) → small (244M) → medium (769M) → large-v3 (1.5B)
# Для русского языка — minimum "small", лучше "medium"
```

```python
import whisper
import json

model = whisper.load_model("medium")  # ~5GB VRAM
result = model.transcribe(
    "audio.wav",
    language="ru",
    word_timestamps=True,
    verbose=False
)

# Сегменты с временными метками
for seg in result["segments"]:
    print(f"[{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text']}")

# Сохраняем для привязки к кадрам
with open("transcript.json", "w", encoding="utf-8") as f:
    json.dump(result["segments"], f, ensure_ascii=False, indent=2)
```

#### Ресурсы по моделям Whisper

| Модель   | VRAM   | Качество RU | Скорость (1ч видео) |
|----------|--------|-------------|---------------------|
| small    | ~2 GB  | Приемлемо   | ~10 мин на RTX 3060 |
| medium   | ~5 GB  | Хорошо      | ~20 мин на RTX 3060 |
| large-v3 | ~10 GB | Отлично     | ~40 мин на RTX 3060 |

### 5.2 faster-whisper (оптимизированный)

```python
from faster_whisper import WhisperModel

# CTranslate2 — в 4 раза быстрее, в 2 раза меньше VRAM
model = WhisperModel("medium", device="cuda", compute_type="float16")

segments, info = model.transcribe("audio.wav", language="ru")
for segment in segments:
    print(f"[{segment.start:.1f}s → {segment.end:.1f}s] {segment.text}")
```

---

## 6. Описание скриншотов (Vision LLM)

### 6.1 Стратегия экономии токенов

```
┌─────────────────────────────────────────────┐
│  Максимальная экономия:                     │
│                                             │
│  1. FFmpeg scene detect → ~50 кадров        │
│     (вместо тысяч)                          │
│  2. SSIM дедупликация → ~20-30 уникальных   │
│  3. Уменьшение разрешения → 1024px по       │
│     длинной стороне (достаточно для UI)     │
│  4. Батчинг: несколько скриншотов в одном    │
│     запросе (до 4-6 штук)                   │
│  5. Привязка транскрипции → контекст без     │
│     дополнительных токенов                  │
│                                             │
│  Итого: 30-минутное видео ≈ 5-10 запросов   │
│  к VLM вместо сотен                         │
└─────────────────────────────────────────────┘
```

### 6.2 Локальная VLM (бесплатно)

**Qwen2-VL** — одна из лучших открытых vision-language моделей:

```python
"""
Qwen2-VL — одна из лучших открытых vision-language моделей
Qwen2-VL-7B: ~16GB VRAM (float16) или ~8GB (int4 quantized)
"""
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
from PIL import Image

model = Qwen2VLForConditionalGeneration.from_pretrained(
    "Qwen/Qwen2-VL-7B-Instruct",
    torch_dtype="auto",
    device_map="auto"
)
processor = AutoProcessor.from_pretrained("Qwen/Qwen2-VL-7B-Instruct")

def describe_screenshot(image_path, transcript_context=""):
    image = Image.open(image_path)

    prompt = f"""Это скриншот из UX-исследования мобильного/веб приложения.
Комментарий пользователя в этот момент: "{transcript_context}"

Опиши кратко:
1. Какой экран/страница показана
2. Что пользователь делает или пытается сделать
3. Ключевые UI-элементы на экране"""

    messages = [
        {"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": prompt}
        ]}
    ]

    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=[text], images=[image], return_tensors="pt").to(model.device)

    output_ids = model.generate(**inputs, max_new_tokens=300)
    description = processor.batch_decode(output_ids, skip_special_tokens=True)[0]
    return description
```

### 6.3 Ollama (проще в установке)

```bash
# Установить Ollama, затем:
ollama pull llava:13b
# или более мощная:
ollama pull llama3.2-vision:11b
```

```python
import ollama
import base64

def describe_with_ollama(image_path, context=""):
    with open(image_path, "rb") as f:
        img_data = base64.b64encode(f.read()).decode()

    response = ollama.chat(
        model="llama3.2-vision:11b",
        messages=[{
            "role": "user",
            "content": f"""UX research screenshot. User comment: "{context}"
Describe: what screen is shown, what the user is doing, key UI elements.""",
            "images": [img_data]
        }]
    )
    return response["message"]["content"]
```

### 6.4 Облачные API (лучшее качество)

```python
"""
Батчинг скриншотов для экономии — отправляем 4-6 изображений в одном запросе.
GPT-4o: ~$0.01-0.03 за изображение 512px (low detail)
Claude Sonnet: сопоставимо
"""
import openai
import base64
from pathlib import Path

client = openai.OpenAI()

def batch_describe(image_paths, transcript_segments):
    """Описать пакет из 4-6 скриншотов за один запрос"""
    content = []

    content.append({
        "type": "text",
        "text": "Это серия скриншотов из UX-исследования в хронологическом порядке. "
                "Для каждого скриншота кратко опиши экран и действие пользователя."
    })

    for i, (img_path, transcript) in enumerate(zip(image_paths, transcript_segments)):
        with open(img_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()

        content.append({
            "type": "text",
            "text": f"\n--- Скриншот {i+1}, комментарий пользователя: \"{transcript}\" ---"
        })
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{b64}",
                "detail": "low"  # ← КРИТИЧНО для экономии! 85 токенов вместо 765+
            }
        })

    response = client.chat.completions.create(
        model="gpt-4o-mini",  # дешевле gpt-4o в ~30 раз для vision
        messages=[{"role": "user", "content": content}],
        max_tokens=1000
    )
    return response.choices[0].message.content
```

---

## 7. Полный пайплайн — всё вместе

```python
"""
Полный пайплайн обработки UX-исследования
Зависимости: pip install opencv-python faster-whisper Pillow scenedetect[opencv]
"""
import json
import subprocess
from pathlib import Path
from datetime import timedelta

# ── Шаг 1: Извлечение ключевых кадров ──
def step1_extract_key_frames(video_path, output_dir="key_frames"):
    """FFmpeg scene detection + SSIM фильтрация"""
    Path(output_dir).mkdir(exist_ok=True)

    # FFmpeg scene detection
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", "select='gt(scene,0.3)',scale=1024:-1",
        "-vsync", "vfn",
        "-frame_pts", "1",
        f"{output_dir}/scene_%04d.png"
    ]
    subprocess.run(cmd, capture_output=True)

    # Дополнительно: Python SSIM дедупликация (см. smart_scene_detect.py)
    # ...
    return sorted(Path(output_dir).glob("*.png"))

# ── Шаг 2: Транскрипция аудио ──
def step2_transcribe(video_path):
    """Извлечь аудио и транскрибировать локально"""
    subprocess.run([
        "ffmpeg", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        "temp_audio.wav", "-y"
    ], capture_output=True)

    from faster_whisper import WhisperModel
    model = WhisperModel("medium", device="cuda", compute_type="float16")
    segments, _ = model.transcribe("temp_audio.wav", language="ru")
    return [{"start": s.start, "end": s.end, "text": s.text} for s in segments]

# ── Шаг 3: Привязка транскрипции к кадрам ──
def step3_align(key_frames, transcript):
    """Для каждого кадра находим ближайший сегмент транскрипции"""
    aligned = []
    for frame_path in key_frames:
        # Извлекаем timestamp из имени файла или метаданных
        ts = extract_timestamp(frame_path)  # реализация зависит от naming

        # Находим текст в окне ±5 секунд
        nearby_text = " ".join(
            seg["text"] for seg in transcript
            if abs(seg["start"] - ts) < 5 or (seg["start"] <= ts <= seg["end"])
        )
        aligned.append({
            "frame": str(frame_path),
            "timestamp": ts,
            "user_comment": nearby_text.strip()
        })
    return aligned

# ── Шаг 4: Описание через VLM ──
def step4_describe(aligned_frames, use_local=True, batch_size=4):
    """Генерация описаний — локально или через API"""
    results = []

    if use_local:
        # Ollama / Qwen2-VL (см. примеры выше)
        for item in aligned_frames:
            desc = describe_with_ollama(item["frame"], item["user_comment"])
            item["description"] = desc
            results.append(item)
    else:
        # Батчинг через API
        for i in range(0, len(aligned_frames), batch_size):
            batch = aligned_frames[i:i+batch_size]
            descs = batch_describe(
                [b["frame"] for b in batch],
                [b["user_comment"] for b in batch]
            )
            # Парсим ответ и распределяем по кадрам
            # ...

    return results

# ── Шаг 5: Генерация отчёта ──
def step5_report(results, output="ux_report.md"):
    with open(output, "w", encoding="utf-8") as f:
        f.write("# UX Research Report\n\n")
        for r in results:
            ts = str(timedelta(seconds=int(r["timestamp"])))
            f.write(f"## [{ts}] {r['frame']}\n\n")
            f.write(f"![screenshot]({r['frame']})\n\n")
            f.write(f"**Комментарий пользователя:** {r['user_comment']}\n\n")
            f.write(f"**Описание экрана:** {r['description']}\n\n")
            f.write("---\n\n")

# ── Запуск ──
if __name__ == "__main__":
    VIDEO = "ux_session.mp4"

    print("Step 1: Extracting key frames...")
    frames = step1_extract_key_frames(VIDEO)

    print("Step 2: Transcribing audio...")
    transcript = step2_transcribe(VIDEO)

    print("Step 3: Aligning transcript with frames...")
    aligned = step3_align(frames, transcript)

    print("Step 4: Describing screenshots...")
    results = step4_describe(aligned, use_local=True)

    print("Step 5: Generating report...")
    step5_report(results)
    print("Done! See ux_report.md")
```

---

## 8. Полная интеграция PySceneDetect в пайплайн

```python
"""
PySceneDetect как ядро пайплайна обработки UX-видео.
Извлекает ключевые кадры + временные метки для привязки к транскрипции.
"""
import cv2
from pathlib import Path
from scenedetect import (
    open_video,
    SceneManager,
    ContentDetector,
    AdaptiveDetector,
)
from scenedetect.scene_manager import save_images


def extract_ux_scenes(video_path: str,
                      output_dir: str = "ux_frames",
                      method: str = "content",
                      threshold: float = 27.0,
                      min_scene_len_sec: float = 2.0):
    """
    Извлекает ключевые кадры из UX-видео.

    Args:
        video_path: путь к видео
        output_dir: куда сохранять скриншоты
        method: "content" или "adaptive"
        threshold: чувствительность (ниже = больше детекций)
        min_scene_len_sec: минимальная длительность сцены в секундах

    Returns:
        list[dict] — список сцен с метаданными
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # ── Открываем видео ──
    video = open_video(video_path)
    fps = video.frame_rate
    min_scene_len = int(min_scene_len_sec * fps)

    # ── Выбираем детектор ──
    if method == "adaptive":
        detector = AdaptiveDetector(
            min_scene_len=min_scene_len,
            adaptive_threshold=3.0,  # чувствительность к изменениям
        )
    else:
        detector = ContentDetector(
            threshold=threshold,
            min_scene_len=min_scene_len,
        )

    # ── Детекция ──
    scene_manager = SceneManager()
    scene_manager.add_detector(detector)
    scene_manager.detect_scenes(video, show_progress=True)
    scene_list = scene_manager.get_scene_list()

    print(f"\nНайдено {len(scene_list)} сцен (метод: {method}, порог: {threshold})")

    # ── Сохраняем скриншоты ──
    # num_images=1 — один кадр на сцену (начало), экономим место
    # num_images=3 — начало, середина, конец (больше контекста)
    save_images(
        scene_list=scene_list,
        video=open_video(video_path),  # переоткрываем для seek
        num_images=1,
        output_dir=output_dir,
        image_extension="png",
    )

    # ── Формируем результат ──
    results = []
    for i, (start, end) in enumerate(scene_list):
        results.append({
            "scene_number": i + 1,
            "start_sec": start.get_seconds(),
            "end_sec": end.get_seconds(),
            "duration_sec": end.get_seconds() - start.get_seconds(),
            "start_timecode": start.get_timecode(),
            "end_timecode": end.get_timecode(),
            # Путь к сохранённому скриншоту
            "screenshot": str(list(Path(output_dir).glob(f"*-Scene-{i+1:03d}-*"))[0])
                          if list(Path(output_dir).glob(f"*-Scene-{i+1:03d}-*")) else None,
        })

    return results


def align_scenes_with_transcript(scenes: list, transcript: list) -> list:
    """
    Привязывает транскрипцию Whisper к каждой сцене.

    Args:
        scenes: результат extract_ux_scenes()
        transcript: сегменты из faster-whisper [{"start": float, "end": float, "text": str}]

    Returns:
        scenes дополненные полем "user_comments"
    """
    for scene in scenes:
        s_start = scene["start_sec"]
        s_end = scene["end_sec"]

        # Собираем все реплики, которые попадают в интервал сцены (±2 сек буфер)
        relevant_text = []
        for seg in transcript:
            if seg["end"] >= (s_start - 2) and seg["start"] <= (s_end + 2):
                relevant_text.append(seg["text"].strip())

        scene["user_comments"] = " ".join(relevant_text) if relevant_text else ""

    return scenes


# ── Пример использования ──
if __name__ == "__main__":
    # Шаг 1: Детекция сцен
    scenes = extract_ux_scenes(
        "ux_session.mp4",
        output_dir="ux_frames",
        method="content",
        threshold=25,        # чуть чувствительнее для UI-переходов
        min_scene_len_sec=2  # не короче 2 секунд
    )

    for s in scenes:
        print(f"  Сцена {s['scene_number']}: "
              f"{s['start_timecode']} → {s['end_timecode']} "
              f"({s['duration_sec']:.1f}s)")

    # Шаг 2: Привязка транскрипции (если уже есть)
    import json
    try:
        with open("transcript.json", "r") as f:
            transcript = json.load(f)
        scenes = align_scenes_with_transcript(scenes, transcript)
        for s in scenes:
            if s["user_comments"]:
                print(f"  Сцена {s['scene_number']}: \"{s['user_comments'][:80]}...\"")
    except FileNotFoundError:
        print("  (транскрипция ещё не готова, запустите whisper)")
```

---

## 9. Сводная таблица решений

| Этап | Инструмент | Стоимость | GPU VRAM | Качество |
|------|-----------|-----------|----------|----------|
| **Кадры** | FFmpeg scene detect | Бесплатно | CPU | ★★★★☆ |
| **Кадры+** | Python SSIM / PySceneDetect | Бесплатно | CPU | ★★★★★ |
| **Транскрипция** | faster-whisper medium | Бесплатно | ~5 GB | ★★★★☆ |
| **Транскрипция** | faster-whisper large-v3 | Бесплатно | ~10 GB | ★★★★★ |
| **Описание** | Ollama + llama3.2-vision | Бесплатно | ~8 GB | ★★★☆☆ |
| **Описание** | Qwen2-VL-7B (int4) | Бесплатно | ~8 GB | ★★★★☆ |
| **Описание** | GPT-4o-mini (low detail) | ~$0.01/кадр | Облако | ★★★★☆ |
| **Описание** | GPT-4o (low detail) | ~$0.03/кадр | Облако | ★★★★★ |

---

## 10. Рекомендации: оптимальный стек

### Для максимальной экономии (всё локально, GTX 3060 12GB+)

- **FFmpeg** scene detect → **Python SSIM** дедупликация
- **faster-whisper medium** для транскрипции
- **Qwen2-VL-7B-Instruct (int4)** или **Ollama llama3.2-vision** для описания

### Для лучшего качества с минимальными затратами

- Кадры и транскрипция — локально (как выше)
- Описание — **GPT-4o-mini** с `detail: "low"` и батчингом по 4-6 кадров
- На 30 минут видео ≈ **25-30 кадров** ≈ **5-8 API-запросов** ≈ **$0.10-0.30**

> **Ключевой принцип: чем больше работы делает FFmpeg и Python до нейросети, тем меньше вы платите.**

---

## 11. Схема места PySceneDetect в пайплайне

```
                         ┌─────────────────────────────┐
                         │   UX-видео (30 мин, 30fps)  │
                         │      = 54 000 кадров         │
                         └─────────────┬───────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                      ▼
          ┌─────────────────┐                   ┌──────────────────┐
          │  PySceneDetect   │                   │  FFmpeg → аудио  │
          │  ContentDetector │                   │  faster-whisper  │
          │  threshold=25    │                   │  транскрипция    │
          └────────┬────────┘                   └────────┬─────────┘
                   │                                      │
                   │  ~30 скриншотов                       │  сегменты с таймкодами
                   │  + таймкоды                           │
                   └──────────────┬───────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │  Привязка: скриншот +    │
                    │  комментарий пользователя│
                    └────────────┬────────────┘
                                 │
                                 ▼  ~30 пар (картинка + текст)
                    ┌─────────────────────────┐
                    │  VLM (Qwen2-VL / GPT-4o)│
                    │  Описание каждого экрана │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  Markdown-отчёт с        │
                    │  скриншотами и описаниями│
                    └─────────────────────────┘
```

---

## Зависимости проекта

```txt
# requirements.txt
opencv-python>=4.8
scenedetect[opencv]>=0.6.7
faster-whisper>=1.0
Pillow>=10.0
scikit-image>=0.21     # для SSIM (опционально, если используете кастомный детектор)
ollama>=0.3            # если используете локальную VLM через Ollama
openai>=1.0            # если используете облачный API
transformers>=4.40     # если используете Qwen2-VL напрямую
```

```bash
# Системные зависимости
# FFmpeg (обязательно)
# Ubuntu/Debian:
sudo apt install ffmpeg

# macOS:
brew install ffmpeg

# Windows: скачать с https://ffmpeg.org/download.html
```