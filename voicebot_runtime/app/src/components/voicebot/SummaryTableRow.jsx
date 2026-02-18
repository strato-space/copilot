import React from "react";

function SummaryTableRow({ row, isLast }) {
  return (
    <div className={`self-stretch inline-flex justify-start items-start h-full ${isLast ? 'border-b border-black/30' : 'border-b border-[#f0f0f0]'}`}>
      <div className="w-1/4 self-stretch p-1 flex justify-start items-center gap-1">
        <div className="flex-1 inline-flex flex-col justify-start items-start">
          <div className="self-stretch justify-center text-black/60 text-[10px] font-normal sf-pro leading-[10px]">{row.goal}</div>
        </div>
      </div>
      <div className="flex-1 self-stretch p-1 flex justify-start items-center gap-2">
        <div className="w-full min-w-0 inline-flex flex-col justify-start items-start">
          <div className="self-stretch justify-center text-black/90 text-[10px] font-normal sf-pro leading-3 p-1">
            {row.summary}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SummaryTableRow;
