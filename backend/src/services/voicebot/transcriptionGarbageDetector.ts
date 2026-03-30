type OpenAiResponsesClient = {
  responses?: {
    create: (params: Record<string, unknown>) => Promise<any>;
  };
};

export type GarbageDetectionResult = {
  checked_at: Date;
  detector_version: string;
  model: string;
  skipped: boolean;
  skip_reason: string | null;
  is_garbage: boolean;
  code: string;
  reason: string;
  raw_output: string | null;
};

export const DEFAULT_GARBAGE_DETECTOR_MODEL = 'gpt-5.4-nano';
const DEFAULT_TIMEOUT_MS = 4_000;
const DETECTOR_VERSION = 'post_transcribe_garbage_v1';
const DEFAULT_CODE_FALSE = 'ok';
const DEFAULT_CODE_TRUE = 'noise_or_garbage';
const SHORT_ARTIFACT_REGEX = /^[\s.,!?;:'"`~()[\]{}\-_/\\|+=*]+$/;
const MIN_TOKEN_COUNT_FOR_REPETITION = 12;
const MAX_UNIQUE_TOKEN_RATIO_FOR_REPETITION = 0.55;
const MIN_REPETITION_COVERAGE = 0.4;

const toFiniteNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const normalizeBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'garbage'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'clean', 'valid'].includes(normalized)) return false;
  return null;
};

const normalizeCode = (value: unknown, isGarbage: boolean): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return isGarbage ? DEFAULT_CODE_TRUE : DEFAULT_CODE_FALSE;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return isGarbage ? DEFAULT_CODE_TRUE : DEFAULT_CODE_FALSE;
  return normalized.slice(0, 64);
};

const normalizeReason = (value: unknown, isGarbage: boolean, code: string): string => {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 280);
  return isGarbage ? `classified_as_${code}` : 'classified_as_valid';
};

const normalizeForPatternChecks = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const detectLowDiversityRepetition = (normalized: string): string | null => {
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < MIN_TOKEN_COUNT_FOR_REPETITION) return null;

  const uniqueRatio = new Set(tokens).size / tokens.length;
  if (uniqueRatio > MAX_UNIQUE_TOKEN_RATIO_FOR_REPETITION) return null;

  for (let size = 5; size >= 3; size -= 1) {
    if (tokens.length < size) continue;
    const ngramCounts = new Map<string, number>();
    for (let i = 0; i <= tokens.length - size; i += 1) {
      const ngram = tokens.slice(i, i + size).join(' ');
      if (ngram.length < 12) continue;
      ngramCounts.set(ngram, (ngramCounts.get(ngram) || 0) + 1);
    }
    for (const count of ngramCounts.values()) {
      if (count < 3) continue;
      const coverage = (count * size) / tokens.length;
      if (coverage >= MIN_REPETITION_COVERAGE) return 'repeated_ngram_loop';
    }
  }

  return null;
};

const classifyLocalSilenceHallucination = (
  transcriptionText: unknown
): { is_garbage: boolean; code: string; reason: string } | null => {
  const normalized = normalizeForPatternChecks(String(transcriptionText || ''));
  if (!normalized) return null;

  const ruleCode = detectLowDiversityRepetition(normalized);
  if (!ruleCode) return null;

  return {
    is_garbage: true,
    code: ruleCode,
    reason: `matched_local_rule_${ruleCode}`,
  };
};

const extractJsonCandidate = (raw: unknown): string => {
  const text = String(raw || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  if (text.startsWith('{') && text.endsWith('}')) return text;
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open >= 0 && close > open) return text.slice(open, close + 1).trim();
  return text;
};

const parseFallbackKeyValue = (
  raw: unknown
): { is_garbage: boolean; code: string; reason: string } | null => {
  const text = String(raw || '');
  const boolMatch = text.match(/is_garbage\s*[:=]\s*([^\n,;]+)/i);
  if (!boolMatch) return null;
  const isGarbage = normalizeBoolean(boolMatch[1]);
  if (isGarbage === null) return null;
  const codeMatch = text.match(/code\s*[:=]\s*["']?([a-z0-9_\-\s]+)["']?/i);
  const reasonMatch = text.match(/reason\s*[:=]\s*["']?([^"\n]+)["']?/i);
  const code = normalizeCode(codeMatch?.[1], isGarbage);
  const reason = normalizeReason(reasonMatch?.[1], isGarbage, code);
  return { is_garbage: isGarbage, code, reason };
};

export const parseGarbageDetectorResponse = (
  rawOutput: unknown
): { is_garbage: boolean; code: string; reason: string } => {
  const candidate = extractJsonCandidate(rawOutput);
  if (!candidate) throw new Error('garbage_detector_empty_response');

  let payload: Record<string, unknown> | { is_garbage: boolean; code: string; reason: string } | null = null;
  try {
    payload = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    payload = parseFallbackKeyValue(rawOutput);
    if (!payload) throw new Error('garbage_detector_invalid_json');
  }

  const isGarbage = normalizeBoolean(payload?.is_garbage);
  if (isGarbage === null) throw new Error('garbage_detector_missing_is_garbage');
  const code = normalizeCode(payload?.code, isGarbage);
  const reason = normalizeReason(payload?.reason, isGarbage, code);
  return { is_garbage: isGarbage, code, reason };
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`garbage_detector_timeout_${timeoutMs}ms`);
      (error as Error & { code?: string }).code = 'garbage_detector_timeout';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const shouldSkipDetector = (
  transcriptionText: unknown
): { skip: boolean; reason: string | null } => {
  const trimmed = typeof transcriptionText === 'string' ? transcriptionText.trim() : '';
  if (!trimmed) return { skip: true, reason: 'empty_transcript' };
  // Guardrail: tiny punctuation-only fragments are common system noise.
  if (trimmed.length <= 6 && SHORT_ARTIFACT_REGEX.test(trimmed)) {
    return { skip: true, reason: 'short_system_artifact' };
  }
  return { skip: false, reason: null };
};

export const detectGarbageTranscription = async ({
  openaiClient,
  transcriptionText,
  timeoutMs = null,
  model = null,
}: {
  openaiClient: OpenAiResponsesClient;
  transcriptionText: string;
  timeoutMs?: number | null;
  model?: string | null;
}): Promise<GarbageDetectionResult> => {
  const checkedAt = new Date();
  const selectedModel = model || process.env.VOICEBOT_GARBAGE_DETECTOR_MODEL || DEFAULT_GARBAGE_DETECTOR_MODEL;
  const resolvedTimeoutMs = toFiniteNumber(
    timeoutMs || process.env.VOICEBOT_GARBAGE_DETECTOR_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const skip = shouldSkipDetector(transcriptionText);

  if (skip.skip) {
    return {
      checked_at: checkedAt,
      detector_version: DETECTOR_VERSION,
      model: selectedModel,
      skipped: true,
      skip_reason: skip.reason,
      is_garbage: false,
      code: DEFAULT_CODE_FALSE,
      reason: skip.reason || DEFAULT_CODE_FALSE,
      raw_output: null,
    };
  }

  const localRuleDecision = classifyLocalSilenceHallucination(transcriptionText);
  if (localRuleDecision) {
    return {
      checked_at: checkedAt,
      detector_version: DETECTOR_VERSION,
      model: selectedModel,
      skipped: false,
      skip_reason: null,
      is_garbage: true,
      code: localRuleDecision.code,
      reason: localRuleDecision.reason,
      raw_output: null,
    };
  }

  if (!openaiClient?.responses?.create) throw new Error('garbage_detector_missing_openai_client');

  const response = await withTimeout(
    openaiClient.responses.create({
      model: selectedModel,
      instructions: [
        'Classify transcript text as garbage/noise or valid speech.',
        'Return JSON only: {"is_garbage": boolean, "code": string, "reason": string}.',
        'Use short snake_case code and concise reason.',
      ].join(' '),
      input: String(transcriptionText || '').slice(0, 3000),
      max_output_tokens: 120,
      store: false,
    }),
    resolvedTimeoutMs
  );

  const rawOutput = String((response as { output_text?: string })?.output_text || '').trim();
  const parsed = parseGarbageDetectorResponse(rawOutput);

  return {
    checked_at: checkedAt,
    detector_version: DETECTOR_VERSION,
    model: selectedModel,
    skipped: false,
    skip_reason: null,
    is_garbage: parsed.is_garbage,
    code: parsed.code,
    reason: parsed.reason,
    raw_output: rawOutput.slice(0, 1000),
  };
};
