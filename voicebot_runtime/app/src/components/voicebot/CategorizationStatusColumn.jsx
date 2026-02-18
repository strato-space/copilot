import React from "react";
import { Tooltip } from "antd";

function getProcessorStatus(pdata) {
    if (pdata?.is_processing) {
        return { icon: '⏳', color: 'text-yellow-700', text: 'В процессе' };
    }
    if (pdata?.is_processed) {
        return { icon: '✅', color: 'text-green-700', text: 'Завершено' };
    }
    if (pdata?.is_failed) {
        return { icon: '❌', color: 'text-red-700', text: 'Ошибка' };
    }
    return { icon: '⏺️', color: 'text-gray-400', text: 'Ожидание' };
}

function CategorizationStatusColumn({ message, session }) {
    const processorDataObj = message.processors_data ? { ...message.processors_data } : {};
    if (processorDataObj.transcription) processorDataObj.transcription.is_processed = message.is_transcribed;
    processorDataObj.finalization = { is_processed: message.is_finalized };
    const processors = session.processors || Object.keys(processorDataObj || {});
    return (
        <div className="w-[104px] flex flex-col justify-start items-start overflow-hidden flex-1-0-0 p-2">
            {processors.length > 0 && (
                <div className="flex flex-col gap-0.5">
                    {processors.map((proc) => {
                        const pdata = processorDataObj[proc] || {};
                        const { icon, color, text } = getProcessorStatus(pdata);
                        return (
                            <Tooltip key={proc} title={<span><b>{proc}</b>: {text}</span>} placement="top">
                                <span className={`flex items-center gap-1 px-1 py-0.5 ${color} cursor-pointer`} style={{ fontSize: '10px', lineHeight: '1.1' }}>
                                    <span>{icon}</span>
                                    <span>{proc}</span>
                                </span>
                            </Tooltip>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default CategorizationStatusColumn;
