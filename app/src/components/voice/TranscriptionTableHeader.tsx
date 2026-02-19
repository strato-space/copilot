interface TranscriptionTableHeaderProps {
    ascending: boolean;
    onToggleSort: () => void;
}

export default function TranscriptionTableHeader({ ascending, onToggleSort }: TranscriptionTableHeaderProps) {
    return (
        <div className="self-stretch h-7 bg-slate-50 shadow-sm border-b border-slate-200 flex items-center px-2 gap-2">
            <button
                onClick={onToggleSort}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 transition-colors"
                title={`Сортировка: ${ascending ? 'по возрастанию' : 'по убыванию'}`}
            >
                {ascending ? (
                    <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                        <path
                            fillRule="evenodd"
                            d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
                            clipRule="evenodd"
                        />
                    </svg>
                ) : (
                    <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                        <path
                            fillRule="evenodd"
                            d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                        />
                    </svg>
                )}
            </button>
            <div className="text-black/60 text-[10px] font-semibold leading-3">Transcription</div>
        </div>
    );
}
