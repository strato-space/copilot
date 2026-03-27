import { extname } from 'node:path';

export type AttachmentMediaKind = 'audio' | 'video' | 'image' | 'binary_document' | 'unknown';

export type TranscriptionEligibilityState = 'eligible' | 'ineligible' | 'pending';

export type CanonicalTransportFields = {
  source: string | null;
  file_id: string | null;
  file_unique_id: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
};

export type MessageProjection = {
  hasAttachments: boolean;
  primaryAttachmentIndex: number | null;
  primaryAttachment: Record<string, unknown> | null;
  mediaKind: AttachmentMediaKind;
  isMediaBearingAttachmentMessage: boolean;
  attachmentIdentity: string;
  payloadFingerprint: string;
  topLevelTransport: CanonicalTransportFields;
  attachmentTransport: CanonicalTransportFields;
  canonicalTransport: CanonicalTransportFields;
  transportConflicts: string[];
};

const normalizeString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeLower = (value: unknown): string => normalizeString(value).toLowerCase();

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const toPositiveNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const parseAttachmentResolutionState = (value: unknown): 'pending' | 'resolved' | null => {
  const normalized = normalizeLower(value);
  if (normalized === 'pending') return 'pending';
  if (normalized === 'resolved') return 'resolved';
  return null;
};

const parseAttachmentEligibility = (value: unknown): 'eligible' | 'ineligible' | null => {
  const normalized = normalizeLower(value);
  if (normalized === 'eligible') return 'eligible';
  if (normalized === 'ineligible') return 'ineligible';
  return null;
};

const readAttachmentMimeType = (attachment: Record<string, unknown> | null): string | null => {
  if (!attachment) return null;
  const fromCamel = normalizeLower(attachment.mimeType);
  if (fromCamel) return fromCamel;
  const fromSnake = normalizeLower(attachment.mime_type);
  return fromSnake || null;
};

const readAttachmentFileName = (attachment: Record<string, unknown> | null): string | null => {
  if (!attachment) return null;
  const fromName = normalizeString(attachment.name);
  if (fromName) return fromName;
  const fromFilename = normalizeString(attachment.filename);
  if (fromFilename) return fromFilename;
  const fromFileName = normalizeString(attachment.file_name);
  return fromFileName || null;
};

const readAttachmentFileSize = (attachment: Record<string, unknown> | null): number | null => {
  if (!attachment) return null;
  const fromSize = toPositiveNumberOrNull(attachment.size);
  if (fromSize != null) return fromSize;
  const fromFileSize = toPositiveNumberOrNull(attachment.file_size);
  return fromFileSize;
};

const inferMediaKindFromFields = ({
  explicitKind,
  mimeType,
  attachmentKind,
  fileName,
}: {
  explicitKind: unknown;
  mimeType: string | null;
  attachmentKind: unknown;
  fileName: string | null;
}): AttachmentMediaKind => {
  const explicit = normalizeLower(explicitKind);
  if (
    explicit === 'audio' ||
    explicit === 'video' ||
    explicit === 'image' ||
    explicit === 'binary_document' ||
    explicit === 'unknown'
  ) {
    return explicit;
  }

  const mime = normalizeLower(mimeType);
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';

  const kind = normalizeLower(attachmentKind);
  if (kind === 'voice' || kind === 'audio') return 'audio';
  if (kind === 'video' || kind === 'video_note') return 'video';
  if (kind === 'photo' || kind === 'image') return 'image';
  if (kind === 'document' || kind === 'file' || kind === 'screenshot') return 'binary_document';

  const extension = normalizeLower(extname(fileName || ''));
  if (['.ogg', '.oga', '.opus', '.mp3', '.wav', '.m4a', '.aac', '.flac'].includes(extension)) return 'audio';
  if (['.webm', '.mp4', '.mov', '.mkv', '.avi', '.m4v'].includes(extension)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg'].includes(extension)) return 'image';
  if (extension) return 'binary_document';
  return 'unknown';
};

const compareAttachmentByPriority = (
  left: { index: number; duration: number; size: number },
  right: { index: number; duration: number; size: number }
): number => {
  if (right.duration !== left.duration) return right.duration - left.duration;
  if (right.size !== left.size) return right.size - left.size;
  return left.index - right.index;
};

const selectPrimaryAttachmentIndex = ({
  attachments,
  explicitIndex,
}: {
  attachments: Record<string, unknown>[];
  explicitIndex: unknown;
}): number | null => {
  const selectDeterministicIndex = (candidateIndexes: number[]): number | null => {
    if (!candidateIndexes.length) return null;
    const ranked = candidateIndexes
      .filter((index) => Number.isInteger(index) && index >= 0 && index < attachments.length)
      .map((index) => {
        const attachment = attachments[index] || {};
        const durationMs = toPositiveNumberOrNull(attachment.duration_ms);
        const durationSeconds =
          toPositiveNumberOrNull(attachment.duration_seconds) ??
          toPositiveNumberOrNull(attachment.duration);
        const duration = durationMs ?? (durationSeconds != null ? durationSeconds * 1000 : 0);
        const size =
          toPositiveNumberOrNull(attachment.file_size) ??
          toPositiveNumberOrNull(attachment.size) ??
          0;
        return { index, duration, size };
      });
    ranked.sort(compareAttachmentByPriority);
    return ranked[0]?.index ?? null;
  };

  const parsedExplicitIndex = Number(explicitIndex);
  const hasExplicitIndex =
    Number.isInteger(parsedExplicitIndex) &&
    parsedExplicitIndex >= 0 &&
    parsedExplicitIndex < attachments.length;
  if (attachments.length === 0) return null;

  const hasClassificationSignals = attachments.some((attachment) =>
    parseAttachmentResolutionState(attachment.classification_resolution_state) != null
    || parseAttachmentEligibility(attachment.transcription_eligibility) != null
    || normalizeLower(attachment.payload_media_kind) !== ''
    || normalizeLower(attachment.transcription_processing_state) !== ''
  );
  if (hasClassificationSignals) {
    const eligibleCandidateIndexes = attachments
      .map((attachment, index) => ({ attachment, index }))
      .filter(({ attachment }) => parseAttachmentEligibility(attachment.transcription_eligibility) === 'eligible')
      .map(({ index }) => index);
    if (hasExplicitIndex && eligibleCandidateIndexes.includes(parsedExplicitIndex)) {
      return parsedExplicitIndex;
    }
    const eligibleIndex = selectDeterministicIndex(eligibleCandidateIndexes);
    if (eligibleIndex != null) return eligibleIndex;
    const hasPending = attachments.some(
      (attachment) => parseAttachmentResolutionState(attachment.classification_resolution_state) === 'pending'
    );
    if (hasPending) return null;
    if (attachments.length === 1) return 0;
  }

  if (hasExplicitIndex) {
    return parsedExplicitIndex;
  }

  const fallbackIndex = selectDeterministicIndex(attachments.map((_attachment, index) => index));
  return fallbackIndex ?? 0;
};

const normalizeTransportValue = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const makeTransportFields = ({
  source,
  file_id,
  file_unique_id,
  file_name,
  file_size,
  mime_type,
}: {
  source?: unknown;
  file_id?: unknown;
  file_unique_id?: unknown;
  file_name?: unknown;
  file_size?: unknown;
  mime_type?: unknown;
}): CanonicalTransportFields => ({
  source: normalizeTransportValue(source),
  file_id: normalizeTransportValue(file_id),
  file_unique_id: normalizeTransportValue(file_unique_id),
  file_name: normalizeTransportValue(file_name),
  file_size: toPositiveNumberOrNull(file_size),
  mime_type: normalizeTransportValue(mime_type)?.toLowerCase() || null,
});

const resolveAttachmentIdentity = ({
  primaryAttachment,
  primaryAttachmentIndex,
}: {
  primaryAttachment: Record<string, unknown> | null;
  primaryAttachmentIndex: number | null;
}): string => {
  if (!primaryAttachment) {
    return Number.isInteger(primaryAttachmentIndex) ? `idx:${primaryAttachmentIndex}` : 'idx:none';
  }

  const candidates = [
    primaryAttachment.attachment_id,
    primaryAttachment.id,
    primaryAttachment.file_unique_id,
    primaryAttachment.file_id,
    primaryAttachment.name,
    primaryAttachment.filename,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) return normalized;
  }
  return Number.isInteger(primaryAttachmentIndex) ? `idx:${primaryAttachmentIndex}` : 'idx:none';
};

const sanitizeJobKeyPart = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, '_')
    .slice(0, 120);

export const resolveMessageProjection = (message: Record<string, unknown>): MessageProjection => {
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
      .map(toRecord)
      .filter((value): value is Record<string, unknown> => Boolean(value))
    : [];
  const primaryAttachmentIndex = selectPrimaryAttachmentIndex({
    attachments,
    explicitIndex: message.primary_transcription_attachment_index,
  });
  const primaryAttachment =
    primaryAttachmentIndex != null && primaryAttachmentIndex >= 0
      ? (attachments[primaryAttachmentIndex] ?? null)
      : null;

  const topLevelTransport = makeTransportFields({
    source: message.source_type,
    file_id: message.file_id,
    file_unique_id: message.file_unique_id,
    file_name: message.file_name,
    file_size: message.file_size,
    mime_type: message.mime_type,
  });
  const attachmentTransport = makeTransportFields({
    source: primaryAttachment?.source,
    file_id: primaryAttachment?.file_id,
    file_unique_id: primaryAttachment?.file_unique_id,
    file_name: readAttachmentFileName(primaryAttachment),
    file_size: readAttachmentFileSize(primaryAttachment),
    mime_type: readAttachmentMimeType(primaryAttachment),
  });
  const mediaKind = inferMediaKindFromFields({
    explicitKind: primaryAttachment?.payload_media_kind ?? message.primary_payload_media_kind,
    mimeType: attachmentTransport.mime_type ?? topLevelTransport.mime_type,
    attachmentKind: primaryAttachment?.kind ?? message.message_type,
    fileName: attachmentTransport.file_name ?? topLevelTransport.file_name,
  });

  const canonicalTransport = makeTransportFields({
    source: attachmentTransport.source ?? topLevelTransport.source,
    file_id: attachmentTransport.file_id ?? topLevelTransport.file_id,
    file_unique_id: attachmentTransport.file_unique_id ?? topLevelTransport.file_unique_id,
    file_name: attachmentTransport.file_name ?? topLevelTransport.file_name,
    file_size: attachmentTransport.file_size ?? topLevelTransport.file_size,
    mime_type: attachmentTransport.mime_type ?? topLevelTransport.mime_type,
  });

  const transportConflicts: string[] = [];
  const trackConflict = (field: keyof CanonicalTransportFields) => {
    const top = topLevelTransport[field];
    const nested = attachmentTransport[field];
    if (top == null || nested == null) return;
    if (String(top) !== String(nested)) transportConflicts.push(field);
  };
  trackConflict('source');
  trackConflict('file_id');
  trackConflict('file_unique_id');
  trackConflict('file_name');
  trackConflict('file_size');
  trackConflict('mime_type');

  const attachmentIdentity = resolveAttachmentIdentity({
    primaryAttachment,
    primaryAttachmentIndex,
  });

  const payloadFingerprint = [
    canonicalTransport.file_unique_id,
    normalizeString(message.file_hash),
    normalizeString(message.hash_sha256),
    canonicalTransport.file_id,
    canonicalTransport.file_name,
  ]
    .map((value) => normalizeString(value))
    .find((value) => Boolean(value)) || '';

  return {
    hasAttachments: attachments.length > 0,
    primaryAttachmentIndex,
    primaryAttachment,
    mediaKind,
    isMediaBearingAttachmentMessage: attachments.length > 0,
    attachmentIdentity,
    payloadFingerprint,
    topLevelTransport,
    attachmentTransport,
    canonicalTransport,
    transportConflicts,
  };
};

export const resolveTranscriptionEligibilityState = ({
  message,
  projection,
}: {
  message: Record<string, unknown>;
  projection: MessageProjection;
}): {
  state: TranscriptionEligibilityState;
  basis: string;
  skipReason: string | null;
  classificationResolutionState: 'pending' | 'resolved';
} => {
  const rawEligibility = normalizeLower(message.transcription_eligibility);
  const rawBasis = normalizeString(message.transcription_eligibility_basis);
  const skipReason = normalizeString(message.transcription_skip_reason) || null;
  const rawResolutionState = normalizeLower(message.classification_resolution_state);

  if (rawResolutionState === 'pending') {
    return {
      state: 'pending',
      basis: rawBasis || 'classification_pending',
      skipReason: null,
      classificationResolutionState: 'pending',
    };
  }
  if (rawEligibility === 'eligible') {
    return {
      state: 'eligible',
      basis: rawBasis || 'message_eligibility',
      skipReason: null,
      classificationResolutionState: 'resolved',
    };
  }
  if (rawEligibility === 'ineligible') {
    return {
      state: 'ineligible',
      basis: rawBasis || 'message_ineligible',
      skipReason,
      classificationResolutionState: 'resolved',
    };
  }

  if (projection.hasAttachments) {
    const rawAttachments = (message as { attachments?: unknown }).attachments;
    const attachments = Array.isArray(rawAttachments)
      ? rawAttachments
        .map((value: unknown) => toRecord(value))
        .filter((value): value is Record<string, unknown> => Boolean(value))
      : [];
    const primaryAttachment =
      projection.primaryAttachment
      ?? (projection.primaryAttachmentIndex != null
        ? attachments[projection.primaryAttachmentIndex] ?? null
        : null);
    const attachmentResolutionState = parseAttachmentResolutionState(
      primaryAttachment?.classification_resolution_state
    );
    const attachmentEligibility = parseAttachmentEligibility(primaryAttachment?.transcription_eligibility);
    const attachmentSkipReason = normalizeString(primaryAttachment?.transcription_skip_reason) || null;

    if (attachmentResolutionState === 'pending') {
      return {
        state: 'pending',
        basis: rawBasis || 'attachment_classification_pending',
        skipReason: null,
        classificationResolutionState: 'pending',
      };
    }
    if (attachmentEligibility === 'ineligible') {
      return {
        state: 'ineligible',
        basis: rawBasis || 'attachment_ineligible',
        skipReason: attachmentSkipReason,
        classificationResolutionState: 'resolved',
      };
    }
    if (attachmentEligibility === 'eligible') {
      return {
        state: 'eligible',
        basis: rawBasis || 'attachment_eligibility',
        skipReason: null,
        classificationResolutionState: 'resolved',
      };
    }
    if (attachmentSkipReason === 'no_audio_track') {
      return {
        state: 'ineligible',
        basis: rawBasis || 'attachment_no_audio_track',
        skipReason: attachmentSkipReason,
        classificationResolutionState: 'resolved',
      };
    }

    if (projection.mediaKind === 'audio' || projection.mediaKind === 'video') {
      return {
        state: 'eligible',
        basis: rawBasis || 'attachment_media_kind',
        skipReason: null,
        classificationResolutionState: 'resolved',
      };
    }
    return {
      state: 'pending',
      basis: rawBasis || 'attachment_requires_classification',
      skipReason: null,
      classificationResolutionState: 'pending',
    };
  }

  const hasDirectTransport =
    Boolean(normalizeString((message as Record<string, unknown>).file_path)) ||
    Boolean(projection.canonicalTransport.file_id) ||
    Boolean(projection.canonicalTransport.file_unique_id);
  const hasTextFallback = Boolean(normalizeString((message as Record<string, unknown>).text));
  const topLevelMimeType = normalizeLower((message as Record<string, unknown>).mime_type);
  const topLevelFileName = normalizeString((message as Record<string, unknown>).file_name);
  const topLevelExtension = normalizeLower(extname(topLevelFileName || ''));
  const looksTranscribableByMime =
    topLevelMimeType.startsWith('audio/') || topLevelMimeType.startsWith('video/');
  const looksTranscribableByExt = [
    '.ogg',
    '.oga',
    '.opus',
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.flac',
    '.webm',
    '.mp4',
    '.mov',
    '.mkv',
    '.avi',
    '.m4v',
  ].includes(topLevelExtension);

  if (hasDirectTransport || hasTextFallback || looksTranscribableByMime || looksTranscribableByExt) {
    return {
      state: 'eligible',
      basis: rawBasis || (hasTextFallback ? 'legacy_text_fallback' : 'legacy_transport_presence'),
      skipReason: null,
      classificationResolutionState: 'resolved',
    };
  }

  const messageType = normalizeLower(message.message_type ?? message.type);
  if (messageType === 'voice') {
    return {
      state: 'eligible',
      basis: rawBasis || 'voice_legacy_equivalent',
      skipReason: null,
      classificationResolutionState: 'resolved',
    };
  }

  return {
    state: 'pending',
    basis: rawBasis || 'eligibility_unknown',
    skipReason: null,
    classificationResolutionState: 'pending',
  };
};

export const buildDeterministicTranscriptionJobKey = ({
  messageId,
  projection,
}: {
  messageId: string;
  projection: MessageProjection;
}): string => {
  const messagePart = sanitizeJobKeyPart(messageId || 'message');
  const attachmentPart = sanitizeJobKeyPart(
    projection.attachmentIdentity || `idx:${projection.primaryAttachmentIndex ?? 'none'}`
  );
  const fingerprintPart = sanitizeJobKeyPart(projection.payloadFingerprint || 'no_fingerprint');
  return `vm:${messagePart}|att:${attachmentPart}|fp:${fingerprintPart}`;
};

export const toAttachmentResultSlotKey = (projection: MessageProjection): string => {
  if (Number.isInteger(projection.primaryAttachmentIndex) && projection.primaryAttachmentIndex! >= 0) {
    return `idx_${projection.primaryAttachmentIndex}`;
  }
  return sanitizeJobKeyPart(projection.attachmentIdentity || 'idx_none');
};
