export default function CategorizationTableHeader() {
    return (
        <div className="w-full self-stretch h-7 bg-slate-50 shadow-sm border-b border-slate-200 inline-flex justify-start items-start">
            <div className="w-12 flex justify-start items-center">
                <div className="flex-1 self-stretch py-2 flex justify-start items-center gap-2.5">
                    <div className="flex-1 px-1 border-r border-slate-200 flex justify-start items-center gap-2">
                        <div className="flex-1 text-center text-black/60 text-[10px] font-semibold leading-3">Time</div>
                    </div>
                </div>
            </div>
            <div className="w-[88px] flex justify-start items-center">
                <div className="flex-1 self-stretch py-2 flex justify-start items-center gap-2.5">
                    <div className="flex-1 px-1 border-l border-r border-slate-200 flex justify-start items-center gap-2">
                        <div className="flex-1 text-center text-black/60 text-[10px] font-semibold leading-3">Audio</div>
                    </div>
                </div>
            </div>
            <div className="flex-1 flex justify-start items-center">
                <div className="flex-1 self-stretch py-2 flex justify-start items-center gap-2.5">
                    <div className="flex-1 px-1 border-l border-r border-slate-200 flex justify-start items-center gap-2">
                        <div className="flex-1 text-black/60 text-[10px] font-semibold leading-3">Text</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
