import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import type { CategorizationRow } from '../../store/sessionsUIStore';
import { formatTimelineSecondsLabel } from '../../utils/voiceTimeline';

interface CategorizationTableRowProps {
    row: CategorizationRow;
    rowId: string;
    isLast?: boolean;
}

export default function CategorizationTableRow({ row }: CategorizationTableRowProps) {
    const highlightedMessageId = useVoiceBotStore((state) => state.highlightedMessageId);
    const toggleSelectedCategorizationRow = useSessionsUIStore((state) => state.toggleSelectedCategorizationRow);
    const isCategorizationRowSelected = useSessionsUIStore((state) => state.isCategorizationRowSelected);

    const isHighlighted = highlightedMessageId && row.message_id === highlightedMessageId;
    const isSelected = isCategorizationRowSelected(row);
    const isImageRow = row.kind === 'image' && typeof row.imageUrl === 'string' && row.imageUrl.trim().length > 0;
    const isSelectable = !isImageRow;

    const handleCheckboxChange = (): void => {
        if (!isSelectable) return;
        toggleSelectedCategorizationRow(row);
    };

    const handleRowClick = (event: React.MouseEvent<HTMLDivElement>): void => {
        const target = event.target as HTMLInputElement;
        if (target?.type === 'checkbox') return;
        if (!isSelectable) return;

        if (event.ctrlKey || event.metaKey) {
            toggleSelectedCategorizationRow(row);
            return;
        }

        toggleSelectedCategorizationRow(row);
    };

    const rowBgClass = isHighlighted
        ? 'bg-blue-500/10'
        : isSelected
            ? 'bg-blue-500/5'
            : '';

    return (
        <div
            className={`flex w-full transition-colors duration-150 ${isSelectable ? 'cursor-pointer hover:bg-slate-50' : ''} ${isSelected ? 'border-l-2 border-blue-500' : ''} ${rowBgClass}`}
            onClick={handleRowClick}
        >
            <div className="w-12 flex flex-col justify-center items-start p-1">
                <span className="text-black/60 text-[8px] font-normal leading-[10px]">
                    {formatTimelineSecondsLabel(row.timeStart)}
                </span>
                <span className="text-black/60 text-[8px] font-normal leading-[10px]">
                    {formatTimelineSecondsLabel(row.timeEnd)}
                </span>
            </div>
            <div className="w-[88px] flex items-start gap-1 p-1 overflow-hidden">
                <span className="w-3 h-3 bg-black/40 rounded-full flex items-start justify-center text-white text-[6px] font-semibold leading-[11px]">
                    {row.avatar}
                </span>
                <span className="flex-1 text-black/90 text-[8px] font-normal leading-[10px] truncate">{row.name}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-start p-1 gap-2">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={handleCheckboxChange}
                    disabled={!isSelectable}
                    className="w-3 h-3 rounded border border-gray-300 text-blue-600 focus:ring-blue-500"
                    onClick={(event) => event.stopPropagation()}
                />
                <div className="min-w-0">
                    <span className="text-black/90 text-[10px] font-normal leading-3 whitespace-pre-line">{row.text}</span>
                    {isImageRow ? (
                        <a
                            href={row.imageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <img
                                src={row.imageUrl}
                                alt={row.imageName || 'attachment'}
                                className="max-h-36 max-w-[220px] rounded border border-slate-200 object-contain bg-white"
                            />
                        </a>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
