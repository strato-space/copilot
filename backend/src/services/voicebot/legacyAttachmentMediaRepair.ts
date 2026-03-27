import { ObjectId, type Db, type Filter } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';
import { normalizeMessageAttachmentTranscriptionContract } from '../../api/routes/voicebot/messageHelpers.js';

const DEFAULT_LIMIT = 200;
const DEFAULT_BATCH_SIZE = 50;
const MAX_LIMIT = 2_000;
const MAX_BATCH_SIZE = 500;

const MEDIA_ATTACHMENT_KINDS = new Set(['audio', 'video']);
const CONTRACT_TOP_LEVEL_FIELDS = [
  'attachments',
  'primary_payload_media_kind',
  'primary_transcription_attachment_index',
  'transcription_eligibility',
  'classification_resolution_state',
  'transcription_processing_state',
  'transcription_skip_reason',
  'transcription_eligibility_basis',
  'classification_rule_ref',
  'source_note_text',
  'file_id',
  'file_unique_id',
  'file_name',
  'file_size',
  'mime_type',
  'is_transcribed',
  'transcription_error',
  'transcription_error_context',
] as const;
const LEGACY_PLACEHOLDER_UNSET_FIELDS = [
  'transcription_method',
  'transcription_raw',
  'transcription',
  'transcription_chunks',
  'transcription_text',
] as const;

type VoiceMessageDoc = Record<string, unknown> & {
  _id: ObjectId;
  session_id?: ObjectId | string;
  attachments?: unknown[];
  message_type?: unknown;
  transcription_method?: unknown;
  primary_payload_media_kind?: unknown;
};

export type RepairLegacyAttachmentMediaOptions = {
  db?: Db;
  apply?: boolean;
  limit?: number;
  batchSize?: number;
  sessionId?: string | null;
  messageIds?: string[];
  includeItems?: boolean;
  now?: Date;
};

export type RepairLegacyAttachmentMediaItem = {
  message_id: string;
  session_id: string | null;
  message_type: string | null;
  media_kind: string | null;
  decision: 'skip_non_media_attachment' | 'no_change' | 'repair';
  repaired: boolean;
  reasons: string[];
};

export type RepairLegacyAttachmentMediaResult = {
  ok: boolean;
  mode: 'dry-run' | 'apply';
  scanned_at: string;
  scanned_messages: number;
  repair_candidates: number;
  repaired: number;
  no_change: number;
  skipped_non_media_attachment: number;
  limit: number;
  batch_size: number;
  filters: {
    session_id: string | null;
    message_ids_count: number;
  };
  items?: RepairLegacyAttachmentMediaItem[];
};

const clampPositiveInt = (value: unknown, fallback: number, minValue: number, maxValue: number): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxValue, Math.max(minValue, parsed));
};

const normalizeObjectIdHex = (value: unknown): string => {
  if (value instanceof ObjectId) return value.toHexString().toLowerCase();
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return /^[a-f0-9]{24}$/i.test(trimmed) ? trimmed : '';
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  const hex = normalizeObjectIdHex(value);
  return hex ? new ObjectId(hex) : null;
};

const toTrimmedStringOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const hasLegacyPlaceholder = (message: VoiceMessageDoc): boolean => {
  const transcriptionMethod = toTrimmedStringOrNull(message.transcription_method);
  if (transcriptionMethod !== 'legacy_attachment') return false;
  const transcriptionText = toTrimmedStringOrNull(message.transcription_text);
  return !transcriptionText;
};

const isAttachmentOriginMessage = (message: VoiceMessageDoc): boolean => {
  if (!Array.isArray(message.attachments) || message.attachments.length === 0) return false;
  const messageType = String(message.message_type || '').trim().toLowerCase();
  if (messageType === 'voice' || messageType === 'audio') return false;
  return true;
};

const resolvePrimaryMediaKind = (normalizedDoc: Record<string, unknown>): string | null => {
  const explicit = toTrimmedStringOrNull(normalizedDoc.primary_payload_media_kind);
  if (explicit === 'audio' || explicit === 'video') return explicit;
  const attachments = Array.isArray(normalizedDoc.attachments)
    ? normalizedDoc.attachments.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
  const primaryIndexRaw = normalizedDoc.primary_transcription_attachment_index;
  const primaryIndex = Number.isInteger(Number(primaryIndexRaw)) ? Number(primaryIndexRaw) : null;
  if (primaryIndex != null && primaryIndex >= 0 && primaryIndex < attachments.length) {
    return toTrimmedStringOrNull(attachments[primaryIndex]?.payload_media_kind);
  }
  const firstMediaAttachment = attachments.find((attachment) => {
    const mediaKind = toTrimmedStringOrNull(attachment.payload_media_kind);
    return mediaKind === 'audio' || mediaKind === 'video';
  });
  if (firstMediaAttachment) return toTrimmedStringOrNull(firstMediaAttachment.payload_media_kind);
  return explicit;
};

const resolvePrimaryMediaAttachmentIndex = (normalizedDoc: Record<string, unknown>): number | null => {
  const attachments = Array.isArray(normalizedDoc.attachments)
    ? normalizedDoc.attachments.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
  if (!attachments.length) return null;
  const explicitIndexRaw = normalizedDoc.primary_transcription_attachment_index;
  const explicitIndex = Number.isInteger(Number(explicitIndexRaw)) ? Number(explicitIndexRaw) : null;
  if (explicitIndex != null && explicitIndex >= 0 && explicitIndex < attachments.length) {
    const mediaKind = toTrimmedStringOrNull(attachments[explicitIndex]?.payload_media_kind);
    if (mediaKind === 'audio' || mediaKind === 'video') return explicitIndex;
  }
  const inferredIndex = attachments.findIndex((attachment) => {
    const mediaKind = toTrimmedStringOrNull(attachment.payload_media_kind);
    return mediaKind === 'audio' || mediaKind === 'video';
  });
  return inferredIndex >= 0 ? inferredIndex : null;
};

const buildContractPatch = ({
  message,
  normalized,
  scannedAt,
}: {
  message: VoiceMessageDoc;
  normalized: Record<string, unknown>;
  scannedAt: Date;
}): { setPatch: Record<string, unknown>; unsetPatch: Record<string, 1> } => {
  if (!hasLegacyPlaceholder(message)) {
    return { setPatch: {}, unsetPatch: {} };
  }

  const normalizedForPatch: Record<string, unknown> = { ...normalized };
  const normalizedAttachments = Array.isArray(normalizedForPatch.attachments)
    ? normalizedForPatch.attachments.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
  const resolvedMediaKind = resolvePrimaryMediaKind(normalizedForPatch);
  if (resolvedMediaKind === 'audio' || resolvedMediaKind === 'video') {
    normalizedForPatch.primary_payload_media_kind = resolvedMediaKind;
    const resolvedPrimaryIndex = resolvePrimaryMediaAttachmentIndex(normalizedForPatch);
    if (resolvedPrimaryIndex != null) {
      normalizedForPatch.primary_transcription_attachment_index = resolvedPrimaryIndex;
      const primaryAttachment = normalizedAttachments[resolvedPrimaryIndex] || null;
      if (primaryAttachment) {
        normalizedForPatch.file_id = toTrimmedStringOrNull(normalizedForPatch.file_id)
          ?? toTrimmedStringOrNull(primaryAttachment.file_id);
        normalizedForPatch.file_unique_id = toTrimmedStringOrNull(normalizedForPatch.file_unique_id)
          ?? toTrimmedStringOrNull(primaryAttachment.file_unique_id);
        normalizedForPatch.file_name = toTrimmedStringOrNull(normalizedForPatch.file_name)
          ?? toTrimmedStringOrNull(primaryAttachment.file_name)
          ?? toTrimmedStringOrNull(primaryAttachment.name)
          ?? toTrimmedStringOrNull(primaryAttachment.filename);
        normalizedForPatch.mime_type = toTrimmedStringOrNull(normalizedForPatch.mime_type)
          ?? toTrimmedStringOrNull(primaryAttachment.mime_type)
          ?? toTrimmedStringOrNull(primaryAttachment.mimeType);
        const topLevelFileSize = Number.isFinite(Number(normalizedForPatch.file_size))
          ? Number(normalizedForPatch.file_size)
          : null;
        const attachmentFileSize = Number.isFinite(Number(primaryAttachment.file_size))
          ? Number(primaryAttachment.file_size)
          : (Number.isFinite(Number(primaryAttachment.size)) ? Number(primaryAttachment.size) : null);
        normalizedForPatch.file_size = topLevelFileSize ?? attachmentFileSize;
      }
    }
    const hasExplicitEligibility = ['eligible', 'ineligible'].includes(
      String(normalizedForPatch.transcription_eligibility || '').trim().toLowerCase()
    );
    const hasSkipReason = Boolean(toTrimmedStringOrNull(normalizedForPatch.transcription_skip_reason));
    const hasResolvedState =
      String(normalizedForPatch.classification_resolution_state || '').trim().toLowerCase() === 'resolved';
    const shouldBackfillPendingState = !hasExplicitEligibility && !hasSkipReason && !hasResolvedState;
    if (shouldBackfillPendingState) {
      normalizedForPatch.classification_resolution_state = 'pending';
      normalizedForPatch.transcription_eligibility = null;
      normalizedForPatch.transcription_processing_state = 'pending_classification';
      normalizedForPatch.transcription_skip_reason = null;
      normalizedForPatch.transcription_eligibility_basis = 'legacy_pending_classification';
      normalizedForPatch.classification_rule_ref = null;
    }
    normalizedForPatch.is_transcribed = false;
  }

  const setPatch: Record<string, unknown> = {};
  const unsetPatch: Record<string, 1> = {};

  for (const field of CONTRACT_TOP_LEVEL_FIELDS) {
    const nextValue = normalizedForPatch[field];
    const prevValue = message[field];
    if (!isDeepStrictEqual(prevValue, nextValue)) {
      setPatch[field] = nextValue;
    }
  }

  setPatch.is_transcribed = false;
  for (const field of LEGACY_PLACEHOLDER_UNSET_FIELDS) {
    delete setPatch[field];
    if (Object.prototype.hasOwnProperty.call(message, field)) {
      unsetPatch[field] = 1;
    }
  }

  if (Object.keys(setPatch).length > 0 || Object.keys(unsetPatch).length > 0) {
    setPatch.contract_projection_repaired_at = scannedAt;
    setPatch.contract_projection_repair_source = 'legacy_attachment_media_backfill_v1';
    setPatch.updated_at = scannedAt;
  }

  return { setPatch, unsetPatch };
};

const buildBaseLegacyRepairQuery = (): Filter<VoiceMessageDoc> => ({
  is_deleted: { $ne: true },
  attachments: { $exists: true, $type: 'array', $ne: [] },
  transcription_method: 'legacy_attachment',
  $or: [
    { transcription_text: null },
    { transcription_text: '' },
    { transcription_text: { $regex: /^\s+$/ } },
  ],
});

export const repairLegacyAttachmentMediaProjection = async ({
  db,
  apply = false,
  limit = DEFAULT_LIMIT,
  batchSize = DEFAULT_BATCH_SIZE,
  sessionId,
  messageIds,
  includeItems = true,
  now = new Date(),
}: RepairLegacyAttachmentMediaOptions = {}): Promise<RepairLegacyAttachmentMediaResult> => {
  const activeDb = db;
  if (!activeDb) {
    throw new Error('db is required');
  }

  const normalizedLimit = clampPositiveInt(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const normalizedBatchSize = clampPositiveInt(batchSize, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const normalizedSessionObjectId = toObjectIdOrNull(sessionId);
  const normalizedMessageIds = Array.from(
    new Set(
      (Array.isArray(messageIds) ? messageIds : [])
        .map((value) => normalizeObjectIdHex(value))
        .filter(Boolean)
    )
  );
  const normalizedMessageObjectIds = normalizedMessageIds.map((value) => new ObjectId(value));

  const messagesCollection = activeDb.collection<VoiceMessageDoc>(VOICEBOT_COLLECTIONS.MESSAGES);
  const query: Filter<VoiceMessageDoc> = {
    ...buildBaseLegacyRepairQuery(),
    ...(normalizedSessionObjectId ? { session_id: normalizedSessionObjectId } : {}),
    ...(normalizedMessageObjectIds.length > 0 ? { _id: { $in: normalizedMessageObjectIds } } : {}),
  };

  const items: RepairLegacyAttachmentMediaItem[] = [];
  let scannedMessages = 0;
  let repairCandidates = 0;
  let repaired = 0;
  let noChange = 0;
  let skippedNonMediaAttachment = 0;
  let lastSeenId: ObjectId | null = null;

  while (scannedMessages < normalizedLimit) {
    const remaining = normalizedLimit - scannedMessages;
    const fetchLimit = Math.min(normalizedBatchSize, remaining);
    if (fetchLimit <= 0) break;

    const batch = await messagesCollection
      .find({
        ...query,
        ...(lastSeenId ? { _id: { ...(query._id as Record<string, unknown> ?? {}), $gt: lastSeenId } } : {}),
      })
      .sort({ _id: 1 })
      .limit(fetchLimit)
      .toArray();
    if (batch.length === 0) break;

    for (const message of batch) {
      scannedMessages += 1;
      lastSeenId = message._id;

      const sessionIdHex = normalizeObjectIdHex(message.session_id) || null;
      const messageType = toTrimmedStringOrNull(message.message_type);
      if (!isAttachmentOriginMessage(message)) {
        skippedNonMediaAttachment += 1;
        if (includeItems) {
          items.push({
            message_id: message._id.toHexString(),
            session_id: sessionIdHex,
            message_type: messageType,
            media_kind: null,
            decision: 'skip_non_media_attachment',
            repaired: false,
            reasons: ['not_attachment_origin_message'],
          });
        }
        continue;
      }

      const normalized = normalizeMessageAttachmentTranscriptionContract(message);
      const mediaKind = resolvePrimaryMediaKind(normalized);
      if (!mediaKind || !MEDIA_ATTACHMENT_KINDS.has(mediaKind)) {
        skippedNonMediaAttachment += 1;
        if (includeItems) {
          items.push({
            message_id: message._id.toHexString(),
            session_id: sessionIdHex,
            message_type: messageType,
            media_kind: mediaKind,
            decision: 'skip_non_media_attachment',
            repaired: false,
            reasons: ['primary_payload_not_media_audio_video'],
          });
        }
        continue;
      }

      const { setPatch, unsetPatch } = buildContractPatch({
        message,
        normalized,
        scannedAt: now,
      });

      const shouldWrite = Object.keys(setPatch).length > 0 || Object.keys(unsetPatch).length > 0;
      if (!shouldWrite) {
        noChange += 1;
        if (includeItems) {
          items.push({
            message_id: message._id.toHexString(),
            session_id: sessionIdHex,
            message_type: messageType,
            media_kind: mediaKind,
            decision: 'no_change',
            repaired: false,
            reasons: ['already_normalized'],
          });
        }
        continue;
      }
      repairCandidates += 1;

      let didRepair = false;
      if (apply) {
        const updateResult = await messagesCollection.updateOne(
          { _id: message._id, is_deleted: { $ne: true } },
          {
            ...(Object.keys(setPatch).length > 0 ? { $set: setPatch } : {}),
            ...(Object.keys(unsetPatch).length > 0 ? { $unset: unsetPatch } : {}),
          }
        );
        didRepair = (updateResult.modifiedCount || 0) > 0;
      }

      if (didRepair) repaired += 1;
      if (includeItems) {
        items.push({
          message_id: message._id.toHexString(),
          session_id: sessionIdHex,
          message_type: messageType,
          media_kind: mediaKind,
          decision: 'repair',
          repaired: didRepair,
          reasons: apply ? ['applied'] : ['dry_run'],
        });
      }
    }
  }

  return {
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    scanned_at: now.toISOString(),
    scanned_messages: scannedMessages,
    repair_candidates: repairCandidates,
    repaired,
    no_change: noChange,
    skipped_non_media_attachment: skippedNonMediaAttachment,
    limit: normalizedLimit,
    batch_size: normalizedBatchSize,
    filters: {
      session_id: normalizedSessionObjectId?.toHexString() || null,
      message_ids_count: normalizedMessageObjectIds.length,
    },
    ...(includeItems ? { items } : {}),
  };
};
