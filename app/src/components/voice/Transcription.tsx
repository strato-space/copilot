import { useVoiceBotStore } from '../../store/voiceBotStore';
import TranscriptionTableHeader from './TranscriptionTableHeader';
import TranscriptionTableRow from './TranscriptionTableRow';

export default function Transcription() {
    const rows = useVoiceBotStore((state) => state.voiceBotMessages);

    return (
        <div className="flex-1 inline-flex flex-col justify-start items-start">
            <TranscriptionTableHeader />
            {rows.map((row, idx) => (
                <div className="flex flex-row w-full shadow-sm bg-white items-stretch" key={row._id || row.message_id || idx}>
                    <div className="flex-1 flex flex-col h-full">
                        <TranscriptionTableRow row={row} isLast={idx === rows.length - 1} />
                    </div>
                </div>
            ))}
        </div>
    );
}
