import { useVoiceBot } from "../../store/voiceBot";
import { useSessionsUI } from "../../store/sessionsUI";
import WidgetIcon from "./WidgetIcon";
import CategorizationTableRow from "./CategorizationTableRow";
import CategorizationTableSummary from "./CategorizationTableSummary";
import CategorizationStatusColumn from "./CategorizationStatusColumn";
import CategorizationTableHeader from "./CategorizationTableHeader";
import PermissionGate from "../PermissionGate";
import { PERMISSIONS } from "../../constants/permissions";
import { Button, message } from "antd";
import _ from "lodash";
import React from "react";
import dayjs from "dayjs";

import { Tooltip } from "antd";

const TelegramIcon = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 240.1 240.1">
    <linearGradient id="Oval_1_" gradientUnits="userSpaceOnUse" x1="-838.041" y1="660.581" x2="-838.041" y2="660.3427" gradientTransform="matrix(1000 0 0 -1000 838161 660581)">
      <stop offset="0" style={{ stopColor: "#2AABEE" }} />
      <stop offset="1" style={{ stopColor: "#229ED9" }} />
    </linearGradient>
    <circle fillRule="evenodd" clipRule="evenodd" fill="url(#Oval_1_)" cx="120.1" cy="120.1" r="120.1" />
    <path fillRule="evenodd" clipRule="evenodd" fill="#FFFFFF" d="M54.3,118.8c35-15.2,58.3-25.3,70-30.2 c33.3-13.9,40.3-16.3,44.8-16.4c1,0,3.2,0.2,4.7,1.4c1.2,1,1.5,2.3,1.7,3.3s0.4,3.1,0.2,4.7c-1.8,19-9.6,65.1-13.6,86.3 c-1.7,9-5,12-8.2,12.3c-7,0.6-12.3-4.6-19-9c-10.6-6.9-16.5-11.2-26.8-18c-11.9-7.8-4.2-12.1,2.6-19.1c1.8-1.8,32.5-29.8,33.1-32.3 c0.1-0.3,0.1-1.5-0.6-2.1c-0.7-0.6-1.7-0.4-2.5-0.2c-1.1,0.2-17.9,11.4-50.6,33.5c-4.8,3.3-9.1,4.9-13,4.8 c-4.3-0.1-12.5-2.4-18.7-4.4c-7.5-2.4-13.5-3.7-13-7.9C45.7,123.3,48.7,121.1,54.3,118.8z" />
  </svg>
);

const voice_message_sources = {
  TELEGRAM: 'telegram',
  WEB: 'web'
}

const getIconByMsg = (msg) => {
  let type = msg.original_message.source_type;
  // поддержка старых сообщений, где source_type не указан
  if (_.isUndefined(type)) type = voice_message_sources.TELEGRAM;
  switch (type) {
    case voice_message_sources.TELEGRAM:
      return <TelegramIcon className="w-6" />;
    case voice_message_sources.WEB:
      const filename = msg.original_message.file_metadata?.original_filename || '';
      const extension = filename.split('.').pop()?.toUpperCase() || 'FILE';
      return (
        <Tooltip title={filename} placement="top">
          <div className="text-blue-500 text-xs font-semibold cursor-help px-1 py-0.5 bg-blue-50 rounded border">
            {extension}
          </div>
        </Tooltip>
      );
    default:
      return "❓";
  }
};

const Categorization = () => {
  const { voiceBotSession, voiceMesagesData, getMessageDataById, createTasksFromRows, socket } = useVoiceBot();
  const {
    selectedCategorizationRows,
    clearSelectedCategorizationRows,
    categorizationSort,
    toggleCategorizationSort,
    initCategorizationSort
  } = useSessionsUI();

  const [messageApi, contextHolder] = message.useMessage();
  const messageKey = 'create-tasks';

  // Инициализируем сортировку при изменении состояния сессии
  React.useEffect(() => {
    initCategorizationSort(voiceBotSession?.is_active);
  }, [voiceBotSession?.is_active, initCategorizationSort]);

  // Слушатель события tickets_prepared для обновления сообщения
  React.useEffect(() => {
    if (socket) {
      const handleTicketsPrepared = () => {
        messageApi.open({
          key: messageKey,
          type: 'success',
          content: 'Готово!',
          duration: 2,
        });
      };

      socket.on('tickets_prepared', handleTicketsPrepared);

      return () => {
        socket.off('tickets_prepared', handleTicketsPrepared);
      };
    }
  }, [socket, messageApi, messageKey]);

  const groups = voiceMesagesData || [];
  groups.sort((a, b) => {
    a.type = a.original_message?.source_type || voice_message_sources.TELEGRAM;
    b.type = b.original_message?.source_type || voice_message_sources.TELEGRAM;

    let comparison = 0;
    if (a.type !== voice_message_sources.TELEGRAM || b.type !== voice_message_sources.TELEGRAM) {
      if (a.message_timestamp > b.message_timestamp) comparison = -1;
      else if (a.message_timestamp < b.message_timestamp) comparison = 1;
    } else {
      if (a.message_id > b.message_id) comparison = -1;
      else if (a.message_id < b.message_id) comparison = 1;
    }

    // Применяем порядок сортировки
    return categorizationSort.ascending ? -comparison : comparison;
  });

  // Получаем все строки для функции "Выделить все"
  const allRows = groups.flatMap(group =>
    group.rows ? group.rows.map(row => ({
      ...row,
      message_id: group.message_id
    })) : []
  );

  // Функция для создания задач из выделенных chunks
  const handleCreateTasks = () => {
    if (!voiceBotSession?._id || selectedCategorizationRows.length === 0) return;

    // Показываем сообщение о загрузке
    messageApi.open({
      key: messageKey,
      type: 'loading',
      content: 'Подготавливаю задачи...',
      duration: 0, // не скрывать автоматически
    });

    // Вызываем функцию из store
    createTasksFromRows(voiceBotSession._id, selectedCategorizationRows);

    // Очищаем выделение
    clearSelectedCategorizationRows();
  };

  return (
    <>
      {contextHolder}
      <div className="w-full overflow-x-auto">
        {selectedCategorizationRows.length > 0 && (
          <div className="flex justify-between mb-2 p-2 bg-blue-50 border-t border-b border-blue-200  ">
            <div className="text-sm">
              Выделено строк: <strong>{selectedCategorizationRows.length}</strong>
              <button
                onClick={clearSelectedCategorizationRows}
                className="ml-2 text-blue-600 hover:text-blue-800 underline"
              >
                Снять выделение
              </button>
            </div>
            <PermissionGate permission={PERMISSIONS.PROJECTS.UPDATE} showFallback={false}>
              <Button onClick={handleCreateTasks}>Создать задачи</Button>
            </PermissionGate>
          </div>
        )}
        <table className="w-full border-collapse bg-white shadow-sm">
          <thead className="border-b border-t border-black/30">
            <tr>
              <th className="w-[48px] border-r border-black/30 align-top">
                <div className="w-[48px] flex justify-start items-center">
                  <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
                    <div className="flex-1 px-1 flex justify-start items-center gap-2">
                      <div className="flex-1 text-center justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Src</div>
                    </div>
                  </div>
                </div>
              </th>
              {/* <th className="w-[32px] border-r border-black/30 align-top">
                <div className="w-[32px] flex justify-start items-center">
                  <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
                    <div className="flex-1 px-1  flex justify-start items-center gap-2">
                      <div className="flex-1 text-center justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Time</div>
                    </div>
                  </div>
                </div>
              </th> */}
              <th className="w-[104px] border-r border-black/30 align-top">
                <div className="w-[104px] flex justify-start items-center">
                  <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
                    <div className="flex-1 px-1 border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
                      <div className="flex-1 text-center justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Обработка</div>
                    </div>
                  </div>
                </div>
              </th>
              <th className="align-top">
                <div className="flex items-center gap-2 py-2 px-1">
                  <button
                    onClick={toggleCategorizationSort}
                    className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 transition-colors"
                    title={`Сортировка: ${categorizationSort.ascending ? 'по возрастанию' : 'по убыванию'}`}
                  >
                    {categorizationSort.ascending ? (
                      <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <CategorizationTableHeader />
                </div>
              </th>
              <th className="w-[136px] border-l border-black/30 align-top">
                <div className="w-[136px] flex justify-start items-center">
                  <div className="flex-1 self-stretch py-2  flex justify-start items-center gap-2.5">
                    <div className="flex-1 px-1 border-l-[0.50px] border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
                      <div className="flex-1 justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Quick Summary</div>
                    </div>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, idx) => (
              <tr key={idx} className="align-top border-b border-black/20">
                <td className="border-r border-black/30 align-top p-2 relative">
                  {getIconByMsg(group)}
                </td>
                {/* <td className="border-r border-black/30 align-top p-2 relative text-[8px]">
                  {dayjs(group.message_timestamp).format('HH:mm:ss:SSS')}
                </td> */}
                <td className="border-r border-black/30 align-top p-0">
                  <CategorizationStatusColumn message={getMessageDataById(group.message_id)} session={voiceBotSession} />
                </td>
                <td className="align-top p-0">
                  {(categorizationSort.ascending
                    ? _.sortBy(group.rows, ['timeEnd'])
                    : _.reverse(_.sortBy(group.rows, ['timeEnd']))
                  ).map((row, i) => {
                    const rowId = `${group.message_id}-${row.timeStart}-${row.timeEnd}`;
                    const rowWithMessageId = { ...row, message_id: group.message_id };
                    return (
                      <CategorizationTableRow
                        row={rowWithMessageId}
                        key={i}
                        rowId={rowId}
                        isLast={i === group.rows.length - 1}
                      />
                    );
                  })}
                </td>
                <td className="border-l border-black/30 align-top p-0">
                  <CategorizationTableSummary summary={group.summary} widgets={group.widgets} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default Categorization

