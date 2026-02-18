import React from "react";
import dayjs from "dayjs";
import { Button, Input, Tooltip, message } from "antd";
import { CheckOutlined, CloseOutlined, CopyOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { useVoiceBot } from "../../store/voiceBot";

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const toTimestampMs = (value) => {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e11 ? value : value * 1000;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1e11 ? numeric : numeric * 1000;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const formatRelativeTime = (secondsValue) => {
  if (!isFiniteNumber(secondsValue) || secondsValue < 0) return null;
  const totalSeconds = Math.floor(secondsValue);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const buildLegacySegments = (legacyChunks, fallbackTimestampMs) => {
  if (!Array.isArray(legacyChunks) || legacyChunks.length === 0) return [];

  const ordered = legacyChunks
    .map((chunk, idx) => {
      const rawIndex = Number(chunk?.segment_index);
      return {
        chunk,
        index: Number.isFinite(rawIndex) ? rawIndex : idx,
        order: idx,
        timestampMs: toTimestampMs(chunk?.timestamp),
      };
    })
    .sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      if (a.timestampMs != null && b.timestampMs != null && a.timestampMs !== b.timestampMs) {
        return a.timestampMs - b.timestampMs;
      }
      return a.order - b.order;
    });

  // `transcription_chunks[].timestamp` is often a processing timestamp (e.g. transcribe finish time),
  // not an audio-time anchor. For UI timelines we anchor to the message timestamp (session audio time).
  const baselineTimestampMs = fallbackTimestampMs ?? null;
  let previousEnd = 0;

  return ordered.map((entry) => {
    const duration = Number(entry?.chunk?.duration_seconds);
    const hasDuration = Number.isFinite(duration) && duration > 0;

    const start = previousEnd;
    const end = hasDuration ? start + duration : null;
    if (hasDuration) previousEnd = end;

    return {
      id: entry?.chunk?.id,
      start,
      end,
      speaker: entry?.chunk?.speaker || null,
      text: entry?.chunk?.text || "",
      is_deleted: Boolean(entry?.chunk?.is_deleted),
      absoluteTimestampMs: baselineTimestampMs != null ? baselineTimestampMs + start * 1000 : null,
    };
  });
};

const getSegmentsFromMessage = (msg) => {
  if (!msg) return [];
  const fallbackMessageTimestampMs = toTimestampMs(msg?.message_timestamp);
  const legacy = Array.isArray(msg?.transcription_chunks) ? msg.transcription_chunks : [];
  const legacySegments = buildLegacySegments(legacy, fallbackMessageTimestampMs);
  const legacyById = new Map(legacySegments.filter((seg) => typeof seg?.id === "string").map((seg) => [seg.id, seg]));

  const transcriptionSegments = msg?.transcription?.segments;
  if (Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0) {
    return transcriptionSegments
      .map((segment) => {
        const fromLegacy = legacyById.get(segment?.id);
        const start = isFiniteNumber(Number(segment?.start))
          ? Number(segment.start)
          : fromLegacy?.start ?? null;
        const end = isFiniteNumber(Number(segment?.end))
          ? Number(segment.end)
          : fromLegacy?.end ?? null;

        // Prefer message-time anchor: `message_timestamp + segment.start`.
        // `fromLegacy.absoluteTimestampMs` may be based on processing time.
        let absoluteTimestampMs = null;
        if (fallbackMessageTimestampMs != null && isFiniteNumber(start)) {
          absoluteTimestampMs = fallbackMessageTimestampMs + start * 1000;
        } else {
          absoluteTimestampMs = fromLegacy?.absoluteTimestampMs ?? null;
        }

        return {
          id: segment?.id,
          start,
          end,
          speaker: segment?.speaker || null,
          text: segment?.text || "",
          is_deleted: Boolean(segment?.is_deleted),
          absoluteTimestampMs,
        };
      })
      .filter((seg) => typeof seg?.id === "string" && seg.id.startsWith("ch_"));
  }

  if (legacySegments.length > 0) {
    return legacySegments
      .filter((seg) => typeof seg?.id === "string" && seg.id.startsWith("ch_"));
  }
  return [];
};

const formatSegmentMeta = (seg) => {
  if (!seg || typeof seg !== "object") return "";
  const speaker = typeof seg.speaker === "string" && seg.speaker.trim() ? seg.speaker.trim() : "";
  return speaker;
};

const isSegmentOid = (value) => typeof value === "string" && value.startsWith("ch_");

const formatSegmentTimeline = (segment, row, sessionBaseTimestampMs) => {
  const start = Number(segment?.start);
  if (!Number.isFinite(start) || start < 0) return null;

  const end = Number(segment?.end);
  const hasEnd = Number.isFinite(end) && end > start;

  const messageTimestampMs = toTimestampMs(row?.message_timestamp);
  const segmentAbsoluteStartMs =
    messageTimestampMs != null
      ? messageTimestampMs + start * 1000
      : toTimestampMs(segment?.absoluteTimestampMs);

  const absoluteLabel = segmentAbsoluteStartMs != null ? dayjs(segmentAbsoluteStartMs).format("HH:mm") : null;

  let relativeStartSeconds = start;
  let relativeEndSeconds = hasEnd ? end : null;

  // Prefer session-relative timeline if we can compute it. This makes it easy to see
  // where a segment sits on the overall session timeline (e.g. subtract 14:54 from 15:01).
  if (Number.isFinite(sessionBaseTimestampMs)) {
    if (messageTimestampMs != null) {
      const messageOffsetSeconds = Math.max(0, (messageTimestampMs - sessionBaseTimestampMs) / 1000);
      relativeStartSeconds = messageOffsetSeconds + start;
      if (hasEnd) relativeEndSeconds = messageOffsetSeconds + end;
    } else if (segmentAbsoluteStartMs != null) {
      const sessionStartSeconds = Math.max(0, (segmentAbsoluteStartMs - sessionBaseTimestampMs) / 1000);
      relativeStartSeconds = sessionStartSeconds;
      if (hasEnd) relativeEndSeconds = sessionStartSeconds + (end - start);
    }
  }

  const relativeStart = formatRelativeTime(relativeStartSeconds);
  if (!relativeStart) return null;

  // Unknown/empty duration: show only the segment start.
  if (!hasEnd || !Number.isFinite(relativeEndSeconds)) {
    if (absoluteLabel) return `${absoluteLabel}, ${relativeStart}`;
    return `${relativeStart}`;
  }

  const relativeEnd = formatRelativeTime(relativeEndSeconds);
  if (!relativeEnd) {
    if (absoluteLabel) return `${absoluteLabel}, ${relativeStart}`;
    return `${relativeStart}`;
  }

  if (absoluteLabel) return `${absoluteLabel}, ${relativeStart} - ${relativeEnd}`;
  return `${relativeStart} - ${relativeEnd}`;
};

const copyTextToClipboard = async (text) => {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      return true;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  return false;
};

function TranscriptionTableRow({ row, isLast, sessionBaseTimestampMs }) {
  const { voiceBotSession, fetchVoiceBotSession, editTranscriptChunk, deleteTranscriptChunk } = useVoiceBot();

  const segments = getSegmentsFromMessage(row);
  const visibleSegments = segments.filter((s) => !s?.is_deleted);

  const [editingOid, setEditingOid] = React.useState(null);
  const [draftText, setDraftText] = React.useState("");
  const [draftReason, setDraftReason] = React.useState("");
  const [busyOid, setBusyOid] = React.useState(null);

  const isBusy = Boolean(busyOid);

  const beginEdit = (seg) => {
    if (!seg || !isSegmentOid(seg.id)) return;
    setEditingOid(seg.id);
    setDraftText(typeof seg.text === "string" ? seg.text : "");
    setDraftReason("");
  };

  const cancelEdit = () => {
    if (isBusy) return;
    setEditingOid(null);
    setDraftText("");
    setDraftReason("");
  };

  const saveEdit = async () => {
    if (!voiceBotSession?._id || !row?._id || !editingOid) return;
    if (!draftText.trim()) {
      message.error("Text is required");
      return;
    }

    setBusyOid(editingOid);
    try {
      await editTranscriptChunk(
        {
          session_id: voiceBotSession._id,
          message_id: row._id,
          segment_oid: editingOid,
          new_text: draftText,
          reason: draftReason.trim() ? draftReason.trim() : undefined,
        },
        { silent: true }
      );
      await fetchVoiceBotSession(voiceBotSession._id);
      message.success("Saved");
      setEditingOid(null);
      setDraftText("");
      setDraftReason("");
      setBusyOid(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setBusyOid(null);
      message.error("Failed");
    }
  };

  const deleteSegment = async (seg) => {
    if (!voiceBotSession?._id || !row?._id || !seg?.id || !isSegmentOid(seg.id)) return;
    if (isBusy) return;

    setBusyOid(seg.id);
    try {
      await deleteTranscriptChunk(
        {
          session_id: voiceBotSession._id,
          message_id: row._id,
          segment_oid: seg.id,
        },
        { silent: true }
      );
      await fetchVoiceBotSession(voiceBotSession._id);
      message.success("Deleted");
      if (editingOid === seg.id) {
        setEditingOid(null);
        setDraftText("");
        setDraftReason("");
      }
      setBusyOid(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setBusyOid(null);
      message.error("Failed");
    }
  };

  const copySegment = async (seg) => {
    const textToCopy = typeof seg?.text === "string" ? seg.text.trim() : "";
    if (!textToCopy) return;
    try {
      const copied = await copyTextToClipboard(textToCopy);
      if (!copied) {
        message.error("Copy is not supported in this browser");
        return;
      }
      message.success("Copied");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      message.error("Failed to copy");
    }
  };

  return (
    <div className={`self-stretch inline-flex justify-start items-start h-full ${isLast ? "border-b border-black/30" : "border-b border-[#f0f0f0]"}`}>
      <div className="flex-1 self-stretch p-1 flex justify-start items-start gap-2">
        <div className="min-w-0 w-full inline-flex flex-col justify-start items-start">
          {visibleSegments.length > 0 ? (
            visibleSegments.map((seg, segIdx) => {
              const segmentKey = seg?.id || `${row?._id || "msg"}:${segIdx}`;
              const segmentMeta = formatSegmentMeta(seg);
              const timelineLabel = formatSegmentTimeline(seg, row, sessionBaseTimestampMs);
              const showActions = isSegmentOid(seg?.id);
              const isEditing = editingOid === seg?.id;

              return (
                <div className="relative w-full p-1 group" key={segmentKey}>
                  {showActions || segmentMeta ? (
                    <div className="w-full flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {segmentMeta ? (
                          <div className="text-black/45 text-[9px] font-normal sf-pro leading-3">
                            {segmentMeta}
                          </div>
                        ) : null}
                      </div>
                      {showActions ? (
                        <div
                          className={[
                            "flex items-start gap-1 transition-opacity",
                            isEditing
                              ? "opacity-0 pointer-events-none"
                              : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
                          ].join(" ")}
                        >
                          <Tooltip title="Copy">
                            <Button
                              size="small"
                              type="text"
                              icon={<CopyOutlined />}
                              onClick={() => copySegment(seg)}
                            />
                          </Tooltip>
                          <Tooltip title="Edit">
                            <Button
                              size="small"
                              type="text"
                              icon={<EditOutlined />}
                              onClick={() => beginEdit(seg)}
                            />
                          </Tooltip>
                          <Tooltip title="Delete">
                            <Button
                              size="small"
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              loading={busyOid === seg?.id}
                              onClick={() => deleteSegment(seg)}
                            />
                          </Tooltip>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="min-w-0 w-full">
                    {isEditing ? (
                      <div className="w-full">
                        <Input.TextArea
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          autoSize={{ minRows: 3, maxRows: 10 }}
                          className="text-[10px] font-normal sf-pro leading-3"
                          disabled={busyOid === seg?.id}
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Button
                            size="small"
                            type="primary"
                            icon={<CheckOutlined />}
                            onClick={saveEdit}
                            loading={busyOid === seg?.id}
                            disabled={!draftText.trim()}
                          >
                            Save
                          </Button>
                          <Button
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={cancelEdit}
                            disabled={busyOid === seg?.id}
                          >
                            Cancel
                          </Button>
                          <Input
                            size="small"
                            value={draftReason}
                            onChange={(e) => setDraftReason(e.target.value)}
                            placeholder="Reason (optional)"
                            className="max-w-[420px] text-[10px] font-normal sf-pro leading-3"
                            disabled={busyOid === seg?.id}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="self-stretch justify-center text-black/90 text-[10px] font-normal sf-pro leading-3 whitespace-pre-wrap break-words">
                          {seg?.text}
                        </div>
                        {timelineLabel ? (
                          <div className="mt-1 text-black/55 text-[9px] font-normal sf-pro leading-3">
                            {timelineLabel}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="self-stretch justify-center text-black/90 text-[10px] font-normal sf-pro leading-3 p-1 whitespace-pre-wrap break-words">
              {row.transcription_text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TranscriptionTableRow;
