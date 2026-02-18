import React from "react";

const TranscriptionTableHeader = () => {
  return (
    <div className="self-stretch h-7 bg-[#FAFAFA] shadow-sm border-b border-[#f0f0f0] inline-flex justify-start items-start">
      <div className="flex-1 flex justify-start items-center">
        <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
          <div className="flex-1 px-1 border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
            <div className="flex-1 text-center justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Transcription</div>
          </div>
        </div>
      </div>  
    </div>
  );
}

export default TranscriptionTableHeader;
