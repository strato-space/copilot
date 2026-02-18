
import React from "react";
import { useVoiceBot } from "../../store/voiceBot";
import { useSessionsUI } from "../../store/sessionsUI";

function CategorizationTableRow({ row, rowId }) {
  const { highlightedMessageId } = useVoiceBot();
  const {
    toggleSelectedCategorizationRow,
    isCategorizationRowSelected
  } = useSessionsUI();

  const isHighlighted = highlightedMessageId && row.message_id === highlightedMessageId;
  const isSelected = isCategorizationRowSelected(row);

  const handleCheckboxChange = () => {
    toggleSelectedCategorizationRow(row);
  };

  const handleRowClick = (e) => {
    // Если клик был по чекбоксу, не обрабатываем клик по строке
    if (e.target.type === 'checkbox') {
      return;
    }

    // Ctrl/Cmd + Click - индивидуальное переключение
    if (e.ctrlKey || e.metaKey) {
      toggleSelectedCategorizationRow(row);
      return;
    }

    // Обычный клик - переключаем выделение
    toggleSelectedCategorizationRow(row);
  };

  return (
    <div
      className={`flex w-full transition-colors duration-150 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''
        }`}
      style={{ backgroundColor: isHighlighted ? 'rgba(59, 130, 246, 0.1)' : isSelected ? 'rgba(59, 130, 246, 0.05)' : 'transparent' }}
      onClick={handleRowClick}
    >

      {/* Time */}
      <div className="w-12 flex flex-col justify-center items-start p-1">
        <span className="text-black/60 text-[8px] font-normal sf-pro leading-[10px]">{row.timeStart}</span>
        <span className="text-black/60 text-[8px] font-normal sf-pro leading-[10px]">{row.timeEnd}</span>
      </div>
      {/* Audio */}
      <div className="w-[88px] flex items-start gap-1 p-1 overflow-hidden">
        <span className="w-3 h-3 bg-black/40 rounded-full flex items-start justify-center text-white text-[6px] font-semibold sf-pro leading-[11px]">{row.avatar}</span>
        <span className="flex-1 text-black/90 text-[8px] font-normal sf-pro leading-[10px] truncate">{row.name}</span>
      </div>
      {/* Text */}
      <div className="flex-1 min-w-0 flex items-start p-1 gap-2">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          className="w-3 h-3 rounded border border-gray-300 text-blue-600 focus:ring-blue-500"
          onClick={(e) => e.stopPropagation()}
        />
        <span className="text-black/90 text-[10px] font-normal sf-pro leading-3 whitespace-pre-line">{row.text}</span>
      </div>
      {/* 
      <div className="w-11 flex items-start p-1">
        <span className="text-black/90 text-[8px] font-normal sf-pro leading-[10px]">{row.goal}</span>
      </div>
      <div className="w-11 flex items-start p-1">
        <span className="text-black/90 text-[8px] font-normal sf-pro leading-[10px]">{row.patt}</span>
      </div>
      <div className="w-[35px] flex items-start justify-center p-1">
        <span className="text-black/90 text-[8px] font-normal sf-pro leading-[10px]">{row.flag}</span>
      </div>
      <div className="w-[95px] flex items-start p-1">
        <span className="text-black/90 text-[8px] font-normal sf-pro leading-[10px]">{row.keywords}</span>
      </div> 
      */}
    </div>
  );
}

export default CategorizationTableRow;
