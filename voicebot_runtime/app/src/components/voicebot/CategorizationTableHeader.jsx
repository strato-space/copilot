import React from "react";

const CategorizationTableHeader = () => {
  return (
    <div className="w-full self-stretch h-7 bg-[#FAFAFA] shadow-sm border-b border-[#f0f0f0] inline-flex justify-start items-start">
      <div className="w-12 flex justify-start items-center">
        <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
          <div className="flex-1 px-1 border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
            <div className="flex-1 text-center justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Time</div>
          </div>
        </div>
      </div>
      <div className="w-[88px] flex justify-start items-center">
        <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
          <div className="flex-1 px-1 border-l-[0.50px] border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
            <div className="flex-1 text-center justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Audio</div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex justify-start items-center">
        <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
          <div className="flex-1 px-1 border-l-[0.50px] border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
            <div className="flex-1 justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Text</div>
          </div>
        </div>
      </div>
      {/* <div className="w-11 flex justify-start items-center">
        <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
          <div className="flex-1 px-1 border-l-[0.50px] border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
            <div className="flex-1 justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Goal</div>
          </div>
        </div>
      </div>
      <div className="w-11 flex justify-start items-center">
        <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
          <div className="flex-1 px-1 border-l-[0.50px] border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
            <div className="flex-1 justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Patt</div>
          </div>
        </div>
      </div>
      <div className="w-[35px] flex justify-center items-center">
        <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
          <div className="flex-1 px-1 border-l-[0.50px] border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
            <div className="flex-1 text-center justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Flag</div>
          </div>
        </div>
      </div>
      <div className="w-[95px] flex justify-start items-center">
        <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
          <div className="flex-1 px-1 border-l-[0.50px] border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
            <div className="flex-1 justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Key Words</div>
          </div>
        </div>
      </div> */}
    </div>
  );
}

export default CategorizationTableHeader;
