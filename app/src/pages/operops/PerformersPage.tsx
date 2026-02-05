import { useEffect } from 'react';
import { Table } from 'antd';
import type { TableColumnType } from 'antd';

import { useKanbanStore } from '../../store/kanbanStore';
import { useAuthStore } from '../../store/authStore';
import { AvatarName } from '../../components/crm';
import type { Performer } from '../../types/crm';

const PerformersPage = () => {
    const { performers, fetchDictionary } = useKanbanStore();
    const { isAuth, loading: authLoading } = useAuthStore();

    useEffect(() => {
        if (isAuth && performers.length < 1) fetchDictionary();
    }, [isAuth, performers.length, fetchDictionary]);

    const columns: TableColumnType<Performer>[] = [
        {
            title: 'Performer Name',
            key: 'real_name',
            width: 60,
            render: (_, record) => <AvatarName name={record.real_name ?? record.name} size={24} />,
        },
        {
            title: 'Corporate Email',
            dataIndex: 'corporate_email',
            key: 'corporate_email',
            width: 60,
        },
        {
            title: 'Telegram Nickname',
            dataIndex: 'telegram_name',
            key: 'telegram_name',
            width: 60,
        },
        {
            title: 'Position',
            dataIndex: 'position',
            key: 'position',
            width: 60,
        },
        {
            title: 'Task Types',
            key: 'task_types',
            width: 60,
            render: () => <div />,
        },
    ];

    if (authLoading) {
        return <div className="p-4">Loading...</div>;
    }

    return (
        <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-0">
            <Table
                columns={columns}
                dataSource={performers}
                size="small"
                rowKey="_id"
                pagination={false}
            />
        </div>
    );
};

export default PerformersPage;
