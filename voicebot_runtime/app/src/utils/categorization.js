const toStringValue = (value) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return String(value);
};

const extractRowsFromCandidate = (candidate) => {
  if (!candidate) return null;
  if (Array.isArray(candidate)) return candidate;
  if (candidate && typeof candidate === "object") {
    if (Array.isArray(candidate.data)) return candidate.data;
    if (Array.isArray(candidate.categorization)) return candidate.categorization;
    if (Array.isArray(candidate.rows)) return candidate.rows;
    if (Array.isArray(candidate.items)) return candidate.items;
  }
  return null;
};

const normalizeTime = (value) => {
  if (value == null) return "";
  if (typeof value === "number") return value.toString();
  return toStringValue(value);
};

export const normalizeCategorizationRow = (row, fallbackMessageId = null) => {
  if (!row || typeof row !== "object") return null;

  const speaker = row.speaker || row.author || row.user || row.name || "Unknown";
  const avatar = row.avatar ||
    (typeof speaker === "string" && speaker.length > 0 ? speaker[0].toUpperCase() : "U");

  return {
    ...row,
    timeStart: normalizeTime(row.timeStart ?? row.start ?? row.start_time ?? row.startTime ?? row.from ?? row.segment_start),
    timeEnd: normalizeTime(row.timeEnd ?? row.end ?? row.end_time ?? row.endTime ?? row.to ?? row.segment_end),
    avatar,
    name: speaker,
    text: row.text || row.content || row.body || "",
    goal: row.related_goal || row.goal || "",
    patt: row.new_pattern_detected || row.pattern || "",
    flag: row.quality_flag || row.quality || row.severity || "",
    keywords: row.topic_keywords || row.keywords || "",
    message_id: fallbackMessageId || row.message_id || row._id || row.id || null,
  };
};

export const getMessageCategorizationRows = (message) => {
  if (!message || typeof message !== "object") return [];

  const primaryCandidates = [
    message.categorization,
    message.processors_data?.categorization,
    message.processors_data?.CATEGORIZATION,
    message.categorization_data,
  ];

  for (const candidate of primaryCandidates) {
    const extracted = extractRowsFromCandidate(candidate);
    if (Array.isArray(extracted) && extracted.length > 0) {
      return extracted
        .map((row) => normalizeCategorizationRow(row, message.message_id))
        .filter(Boolean);
    }
  }

  return [];
};
