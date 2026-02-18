import React from "react";
import { useVoiceBot } from "../../store/voiceBot";

import TranscriptionTableHeader from "./TranscriptionTableHeader";
import TranscriptionTableRow from "./TranscriptionTableRow";

const Transcription = () => {
  const { voiceBotMessages } = useVoiceBot();
  const rows = voiceBotMessages || [];

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

  const sessionBaseTimestampMs = React.useMemo(() => {
    const stamps = rows
      .map((msg) => toTimestampMs(msg?.message_timestamp))
      .filter((value) => value != null);
    if (stamps.length === 0) return null;
    return Math.min(...stamps);
  }, [rows]);

  return (
    <div className="flex-1 inline-flex flex-col justify-start items-start">
      <TranscriptionTableHeader />
      {rows.map((row, idx) => (
        <div className="flex flex-row w-full shadow-sm bg-white items-stretch" key={row?._id || idx}>
          <div className="flex-1 flex flex-col h-full">
            <TranscriptionTableRow
              row={row}
              isLast={idx === rows.length - 1}
              sessionBaseTimestampMs={sessionBaseTimestampMs}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default Transcription;
