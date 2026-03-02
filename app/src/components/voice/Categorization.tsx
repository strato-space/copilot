import { useEffect, useMemo } from 'react';
import { Button, message } from 'antd';
import _ from 'lodash';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import PermissionGate from './PermissionGate';
import { PERMISSIONS } from '../../constants/permissions';
import CategorizationTableRow from './CategorizationTableRow';
import CategorizationTableHeader from './CategorizationTableHeader';
import { getCategorizationRowIdentity } from '../../utils/categorizationRowIdentity';

const voiceMessageSources = {
    TELEGRAM: 'telegram',
    WEB: 'web',
} as const;

export default function Categorization() {
    const { voiceBotSession, voiceMesagesData, createTasksFromRows, socket } = useVoiceBotStore();
    const {
        selectedCategorizationRows,
        clearSelectedCategorizationRows,
        categorizationSort,
        toggleCategorizationSort,
        initCategorizationSort,
    } = useSessionsUIStore();

    const [messageApi, contextHolder] = message.useMessage();
    const messageKey = 'create-tasks';

    useEffect(() => {
        initCategorizationSort(voiceBotSession?.is_active);
    }, [voiceBotSession?.is_active, initCategorizationSort]);

    useEffect(() => {
        if (!socket) return undefined;
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
    }, [socket, messageApi, messageKey]);

    const groups = useMemo(() => {
        const list = [...(voiceMesagesData || [])];
        const toTimestamp = (value: string | number | undefined): number => {
            if (value === undefined || value === null) return 0;
            const numeric = Number(value);
            return Number.isNaN(numeric) ? 0 : numeric;
        };

        list.sort((a, b) => {
            const aType = a.original_message?.source_type || voiceMessageSources.TELEGRAM;
            const bType = b.original_message?.source_type || voiceMessageSources.TELEGRAM;

            let comparison = 0;
            if (aType !== voiceMessageSources.TELEGRAM || bType !== voiceMessageSources.TELEGRAM) {
                const aTime = toTimestamp(a.message_timestamp);
                const bTime = toTimestamp(b.message_timestamp);
                if (aTime > bTime) comparison = -1;
                else if (aTime < bTime) comparison = 1;
            } else {
                if (a.message_id && b.message_id) {
                    if (a.message_id > b.message_id) comparison = -1;
                    else if (a.message_id < b.message_id) comparison = 1;
                }
            }

            return categorizationSort.ascending ? -comparison : comparison;
        });
        return list.filter((group) => {
            const hasTextRows = Array.isArray(group.rows) && group.rows.some((row) => {
                const text = typeof row.text === 'string' ? row.text.trim() : '';
                return text.length > 0;
            });
            const hasMaterials = Array.isArray(group.materials) && group.materials.some((material) =>
                typeof material.imageUrl === 'string' && material.imageUrl.trim().length > 0
            );
            return hasTextRows || hasMaterials;
        });
    }, [voiceMesagesData, categorizationSort.ascending]);

    const handleCreateTasks = (): void => {
        if (!voiceBotSession?._id || selectedCategorizationRows.length === 0) return;

        messageApi.open({
            key: messageKey,
            type: 'loading',
            content: 'Подготавливаю задачи...',
            duration: 0,
        });

        createTasksFromRows(voiceBotSession._id, selectedCategorizationRows as Array<{ text?: string }>);
        clearSelectedCategorizationRows();
    };

    return (
        <>
            {contextHolder}
            <div className="w-full overflow-x-auto">
                {selectedCategorizationRows.length > 0 && (
                    <div className="flex justify-between mb-2 p-2 bg-blue-50 border-t border-b border-blue-200">
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
                            <th className="align-top">
                                <div className="flex items-center gap-2 py-2 px-1">
                                    <button
                                        onClick={toggleCategorizationSort}
                                        className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 transition-colors"
                                        title={`Сортировка: ${categorizationSort.ascending ? 'по возрастанию' : 'по убыванию'}`}
                                    >
                                        {categorizationSort.ascending ? (
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
                                    <CategorizationTableHeader />
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map((group, idx) => {
                            const sortedRows = categorizationSort.ascending
                                ? _.sortBy(group.rows, ['timeEnd'])
                                : _.reverse(_.sortBy(group.rows, ['timeEnd']));
                            const materials = Array.isArray(group.materials)
                                ? group.materials.filter((material) =>
                                    typeof material.imageUrl === 'string' && material.imageUrl.trim().length > 0
                                )
                                : [];
                            const rowsToRender = sortedRows.length > 0
                                ? sortedRows
                                : materials.length > 0
                                    ? [
                                        {
                                            avatar: '',
                                            name: '',
                                            text: '',
                                            kind: 'text' as const,
                                            message_id: group.message_id,
                                            message_timestamp: group.message_timestamp,
                                            row_index: 0,
                                        },
                                    ]
                                    : [];

                            return (
                                <tr key={group.message_id || idx} className="align-top border-b border-black/20">
                                    <td className="align-top p-0">
                                        {rowsToRender.map((row, i) => {
                                            const rowWithMessageId = group.message_id ? { ...row, message_id: group.message_id } : row;
                                            const rowId = getCategorizationRowIdentity(rowWithMessageId);
                                            return (
                                                <CategorizationTableRow
                                                    row={rowWithMessageId}
                                                    materials={i === 0 ? materials : []}
                                                    key={rowId}
                                                    rowId={rowId}
                                                    isLast={i === rowsToRender.length - 1}
                                                />
                                            );
                                        })}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
}
