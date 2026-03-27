import {
  resolveMessageProjection,
  resolveTranscriptionEligibilityState,
  type TranscriptionEligibilityState,
} from './transcriptionProjection.js';

export type CanonicalTranscriptionProcessingState =
  | 'pending_classification'
  | 'pending_transcription'
  | 'transcribed'
  | 'classified_skip'
  | 'transcription_error';

export type RetryOrchestrationState = {
  state: TranscriptionEligibilityState;
  isTranscribed: boolean;
  classificationResolutionState: 'pending' | 'resolved';
  transcriptionEligibility: 'eligible' | 'ineligible' | null;
  processingState: CanonicalTranscriptionProcessingState;
  basis: string;
  hasTranscriptionError: boolean;
};

const normalizeLower = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const normalizeString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const parseProcessingState = (value: unknown): CanonicalTranscriptionProcessingState | null => {
  const normalized = normalizeLower(value);
  if (
    normalized === 'pending_classification'
    || normalized === 'pending_transcription'
    || normalized === 'transcribed'
    || normalized === 'classified_skip'
    || normalized === 'transcription_error'
  ) {
    return normalized;
  }
  return null;
};

const hasTranscriptionErrorValue = (value: unknown): boolean => {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return true;
  return false;
};

export const resolveRetryOrchestrationState = (
  message: Record<string, unknown>
): RetryOrchestrationState => {
  const projection = resolveMessageProjection(message);
  const eligibility = resolveTranscriptionEligibilityState({ message, projection });
  const explicitProcessingState = parseProcessingState(message.transcription_processing_state);
  const explicitResolutionState = normalizeLower(message.classification_resolution_state);
  const explicitEligibility = normalizeLower(message.transcription_eligibility);
  const hasTranscriptionError = hasTranscriptionErrorValue(message.transcription_error);
  const hasLegacyRetrySignals =
    message.to_transcribe === true
    || normalizeString(message.transcription_retry_reason).length > 0
    || hasTranscriptionError
    || Number(message.transcribe_attempts || 0) > 0
    || explicitProcessingState === 'pending_transcription'
    || explicitProcessingState === 'transcription_error';

  let state: TranscriptionEligibilityState = eligibility.state;
  if (explicitResolutionState === 'pending' || explicitProcessingState === 'pending_classification') {
    state = 'pending';
  } else if (explicitEligibility === 'eligible') {
    state = 'eligible';
  } else if (explicitEligibility === 'ineligible' || explicitProcessingState === 'classified_skip') {
    state = 'ineligible';
  } else if (state === 'pending' && hasLegacyRetrySignals) {
    // Legacy messages can miss explicit contract fields but still carry retry intent.
    state = 'eligible';
  }

  const isTranscribed = Boolean(message.is_transcribed) || explicitProcessingState === 'transcribed';
  const processingState: CanonicalTranscriptionProcessingState = isTranscribed
    ? 'transcribed'
    : state === 'pending'
      ? 'pending_classification'
      : state === 'ineligible'
        ? 'classified_skip'
        : explicitProcessingState === 'transcription_error' && hasTranscriptionError && message.to_transcribe !== true
          ? 'transcription_error'
          : 'pending_transcription';

  return {
    state,
    isTranscribed,
    classificationResolutionState: state === 'pending' ? 'pending' : 'resolved',
    transcriptionEligibility: state === 'pending' ? null : state,
    processingState,
    basis: normalizeString(message.transcription_eligibility_basis) || eligibility.basis,
    hasTranscriptionError,
  };
};
