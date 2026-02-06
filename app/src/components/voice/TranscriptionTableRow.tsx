import dayjs from 'dayjs';
import type { VoiceBotMessage } from '../../types/voice';

interface TranscriptionTableRowProps {
    row: VoiceBotMessage;
    isLast: boolean;
}

export default function TranscriptionTableRow({ row, isLast }: TranscriptionTableRowProps) {
    return (
        <div
            className={`self-stretch inline-flex justify-start items-start h-full ${isLast ? 'border-b border-black/30' : 'border-b border-slate-200'
                }`}
        >
            <div className="w-12 self-stretch p-1 flex justify-start items-center gap-1">
                <div className="flex-1 inline-flex flex-col justify-start items-start">
                    <div className="self-stretch text-center text-black/60 text-[8px] font-normal leading-[10px]">
                        {row.message_timestamp ? dayjs(row.message_timestamp).format('HH:mm:ss') : '—'}
                    </div>
                </div>
            </div>
            <div className="flex-1 self-stretch p-1 flex justify-start items-center gap-2">
                <div className="min-w-0 inline-flex flex-col justify-start items-start">
                    <div className="self-stretch text-black/90 text-[10px] font-normal leading-3 p-1">
                        {row.transcription_text || ''}
                    </div>
                </div>
            </div>
        </div>
    );
}
