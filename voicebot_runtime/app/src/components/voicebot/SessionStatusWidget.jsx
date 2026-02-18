import React, { useState, useEffect } from "react";
import { Button, Tooltip, Select, Modal } from "antd";
import { EditOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import _ from "lodash";
import dayjs from "dayjs";

import { useVoiceBot } from "../../store/voiceBot";
import AudioUploader from "../AudioUploader";

/*
sample:
voiceBotSession
{
    "_id": "686d3c6e206a3ed26987f666",
    "chat_id": 214255344,
    "session_type": "multiprompt_voice_session",
    "is_active": true,
    "created_at": "2025-07-08T15:42:38.590Z",
    "is_messages_processed": true,
    "processors": [
        "transcription",
        "categorization",
        "summarization",
        "questioning",
        "finalization"
    ],
    "is_waiting": false,
    "last_message_id": 3308,
    "last_message_timestamp": 1751989413,
    "last_voice_timestamp": 1751989413361,
    "current_spreadsheet_file_id": "1y4EifQx70ERdGZP4VchHMfUF97tuSbxsykKJtseGpqw",
    "is_finalized": false
}
*/

/*

🟢/🔴 Статус активности:
is_active → "Активна" / "Завершена"

✅/⏳ Сообщения обработаны:
is_messages_processed → "Все сообщения обработаны" / "Ожидание обработки"

🔁 Постпроцессинг:
is_postprocessing → "Постобработка..." / "Постобработка завершена"

🏁 Финализирована:
is_finalized → "Финал" / "В процессе"

⏱️ Ожидание первого сообщения:
is_waiting → "Ожидание первого войса"


для сессии — показать список процессоров с индикаторами статуса:

Вариант отображения:

Процессор 1: ⏳ / ✅ / ❌

Процессор 2: ⏳ / ✅ / ❌

Процессор 3: ⏳ / ✅ / ❌

Tooltip на каждом процессоре может расшифровывать статус (наводишь — видишь детали).


5. Цветовая индикация
Зеленый — завершено

Желтый — в процессе

Серый — в ожидании

Красный — ошибка/фейл



## Флаги сессии:

is_finalized: true - если сессия обработана всеми постобработчиками
is_messages_processed: true если все сообщения обработаны всеми способами
is_postprocessing: true если в данный момент сессия обрабатывается постпроцессорами
is_waiting: true в промежутке между началом сессии и первым полученым войсом
to_finalize: true если пользователь нажал Дон

processors_data[]:
  is_processed: true если обработчик завершил работу
  is_processing: true в момент когда обработчик работает 

*/
// This component displays the session status widget for the voice bot session.
const SessionStatusWidget = () => {
    const { voiceBotSession, updateSessionName } = useVoiceBot();
    const [uploaderModalVisible, setUploaderModalVisible] = useState(false);

    const handleUploadComplete = (result) => {
        setUploaderModalVisible(false);
        // Можно добавить дополнительную логику обработки результата загрузки
    };

    if (!voiceBotSession) return null;
    // Сессионные статусы с иконками и цветами
    const sessionStatus = [
        {
            key: 'is_waiting',
            icon: '⏱️',
            label: voiceBotSession.is_waiting ? 'Ожидание первого войса' : 'Голос получен',
            color: voiceBotSession.is_waiting ? 'text-blue-700' : 'text-gray-500',
            isShown: voiceBotSession.is_waiting,
        },
        {
            key: 'is_messages_processed',
            icon: voiceBotSession.is_messages_processed ? '✅' : '⏳',
            label: voiceBotSession.is_messages_processed ? 'Все сообщения обработаны' : 'Ожидание обработки сообщений',
            color: voiceBotSession.is_messages_processed ? 'text-green-700' : 'text-yellow-700',
            isShown: true,
        },
        {
            key: 'is_postprocessing',
            icon: voiceBotSession.is_postprocessing && !voiceBotSession.is_finalized ? '🔁' : '✔️',
            label: voiceBotSession.is_postprocessing && !voiceBotSession.is_finalized ? 'Постобработка...' : 'Постобработка завершена',
            color: voiceBotSession.is_postprocessing && !voiceBotSession.is_finalized ? 'text-yellow-700' : 'text-green-700',
            isShown: voiceBotSession.is_messages_processed && voiceBotSession.to_finalize,
        },
        {
            key: 'is_finalized',
            icon: voiceBotSession.is_finalized ? '🏁' : '⏳',
            label: voiceBotSession.is_finalized ? 'Сессия полностью обработана' : 'Сессия в процессе обработки',
            color: voiceBotSession.is_finalized ? 'text-green-700' : 'text-yellow-700',
            isShown: voiceBotSession.to_finalize,
        },
    ];

    // Процессоры: статус и цвет
    const processors = voiceBotSession.session_processors || Object.keys(voiceBotSession.processors_data || {});
    // processors_data теперь объект: { [processor]: { ...data } }
    const processorsData = voiceBotSession.processors_data || {};
    // Функция для статуса процессора
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

    return (
        <div
            className="voice-session-status-widget w-full max-w-[1740px] mx-auto"
            style={{ fontSize: '12px', lineHeight: '1.1' }}
        >
            <div className="voice-status-card flex justify-between items-center w-full px-3 py-2">
                <div className="inline-flex flex-col justify-center items-start gap-1 h-auto py-2">
                    {/* Верхняя строка с сессионными статусами */}
                    <div className="flex justify-between items-center w-full mb-1">
                        <div className="flex flex-wrap gap-2">
                            {sessionStatus.filter(flag => flag.isShown).map((flag) => (
                                <span key={flag.key} className={`voice-status-flag inline-flex items-center gap-1 font-medium ${flag.color}`} style={{ fontSize: '11px', padding: '1px 8px' }}>
                                    <span>{flag.icon}</span>
                                    <span>{flag.label}</span>
                                </span>
                            ))}
                        </div>

                    </div>
                    {/* Процессоры (компактно, с названиями) */}
                    {processors.length > 0 && (
                        <div className="flex flex-row flex-wrap gap-2 mt-1 items-center">
                            <span className="text-[10px] text-gray-400 mr-1">Процессоры:</span>
                            {processors.map((proc) => {
                                const pdata = processorsData[proc] || {};
                                const { icon, color, text } = getProcessorStatus(pdata);
                                return (
                                    <Tooltip key={proc} title={<span><b>{proc}</b>: {text}</span>} placement="top">
                                        <span className={`voice-status-processor flex items-center gap-1 px-2 py-1 rounded border border-gray-200 ${color} cursor-pointer bg-gray-50`} style={{ fontSize: '11px', lineHeight: '1.1' }}>
                                            <span>{icon}</span>
                                            <span>{proc}</span>
                                        </span>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    )}
                </div>
                {/* Кнопка загрузки аудио */}
                <Button
                    type="default"
                    icon={<UploadOutlined />}
                    className="voice-status-upload-button"
                    onClick={() => setUploaderModalVisible(true)}
                    disabled={voiceBotSession?.is_deleted}
                    size="middle"
                >
                    Загрузить аудио
                </Button>
            </div>



            {/* Модальное окно для загрузки аудио */}
            <Modal
                title="Загрузить аудио файл"
                open={uploaderModalVisible}
                onCancel={() => setUploaderModalVisible(false)}
                footer={null}
                width={600}
                destroyOnHidden
            >
                <AudioUploader
                    sessionId={voiceBotSession?._id}
                    onUploadComplete={handleUploadComplete}
                    disabled={voiceBotSession?.is_deleted}
                />
            </Modal>
        </div>
    );
}


export default SessionStatusWidget;
