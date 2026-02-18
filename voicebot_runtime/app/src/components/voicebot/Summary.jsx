
import { useVoiceBot } from "../../store/voiceBot";
import SummaryTableHeader from "./SummaryTableHeader";
import SummaryTableRow from "./SummaryTableRow";

const Summary = () => {
  const { voiceBotMessages = [] } = useVoiceBot();
  // Собираем все summary из processors_data.summarization.data
  const rows = (voiceBotMessages || [])
    .flatMap(msg => {
      const summaries = msg?.processors_data?.summarization?.data || [];
      // summary может быть массивом объектов с полями goal и summary
      return summaries.map(s => ({
        goal: s.goal || "",
        summary: s.summary || ""
      }));
    })
    .filter(row => row.summary); // фильтруем пустые

  return (
    <div className="flex-1 inline-flex flex-col justify-start items-start">
      <SummaryTableHeader />
      {rows.map((row, idx) => (
        <div className="flex flex-row w-full shadow-sm bg-white items-stretch" key={idx}>
          <div className="flex-1 flex flex-col h-full">
            <SummaryTableRow row={row} key={idx} isLast={idx === rows.length - 1} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default Summary;
