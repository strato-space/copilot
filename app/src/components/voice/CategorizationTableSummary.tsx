import type { ReactElement } from 'react';

interface CategorizationTableSummaryProps {
    summary: { text?: string };
}

export default function CategorizationTableSummary({ summary }: CategorizationTableSummaryProps): ReactElement {
    return (
        <div className="w-[136px] flex flex-col justify-start items-start overflow-hidden flex-1-0-0">
            <div className="p-2 flex flex-col grow justify-between items-stretch">
                {summary?.text ? (
                    <div className="text-black/90 text-[9px] font-normal leading-[10px] pt-1">{summary.text}</div>
                ) : (
                    <div className="text-slate-400 text-[9px]">—</div>
                )}
            </div>
        </div>
    );
}
