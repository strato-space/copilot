import { useEffect } from 'react';
import { Table, Spin, ConfigProvider } from 'antd';
import type { TableColumnType } from 'antd';
import _ from 'lodash';
import cn from 'classnames';

import { useCRMStore } from '../../store/crmStore';
import { useAuthStore } from '../../store/authStore';
import type { WeekReportItem } from '../../types/crm';
import ProjectTag from './ProjectTag';

const CRMReports = () => {
    const { fetchReports, week_reports } = useCRMStore();
    const { isAuth, loading: authLoading } = useAuthStore();

    useEffect(() => {
        if (isAuth) fetchReports();
    }, [isAuth, fetchReports]);

    const compareStrings = (a: string | undefined | null, b: string | undefined | null): number => {
        if (_.isEmpty(a) && _.isEmpty(b)) return 0;
        if (_.isEmpty(a) && !_.isEmpty(b)) return 1;
        if (!_.isEmpty(a) && _.isEmpty(b)) return -1;
        return (a ?? '').localeCompare(b ?? '');
    };

    const dayColumn = (key: keyof WeekReportItem, label: string): TableColumnType<WeekReportItem> => ({
        title: <div className="flex justify-center items-center">{label}</div>,
        key,
        width: 80,
        render: (_, record) => {
            const value = record[key];
            const plannedValue = record.planned?.[key as keyof typeof record.planned];
            return (
                <div
                    className={cn(
                        'absolute top-0 right-0 w-full h-full flex justify-center items-center',
                        {
                            'bg-green-100': value,
                            'bg-yellow-100': plannedValue && !value,
                        }
                    )}
                >
                    {value ? String(value) : (plannedValue ? String(plannedValue) : '')}
                </div>
            );
        },
    });

    const columns: TableColumnType<WeekReportItem>[] = [
        {
            title: 'P',
            width: 60,
            dataIndex: 'priority',
            sorter: (a, b) => compareStrings(a.priority, b.priority),
            defaultSortOrder: 'ascend',
        },
        {
            title: 'Проект',
            width: 120,
            dataIndex: 'project',
            render: (_, record) => <ProjectTag name={record.project} tooltip={record.project} />,
        },
        {
            title: 'Тип',
            width: 80,
            dataIndex: 'type',
        },
        {
            title: 'Задача',
            dataIndex: 'name',
        },
        {
            title: 'Статус',
            width: 200,
            dataIndex: 'task_status',
        },
        // Uncomment if day columns are needed:
        // dayColumn('Mo', 'Пн'),
        // dayColumn('Tu', 'Вт'),
        // dayColumn('We', 'Ср'),
        // dayColumn('Th', 'Чт'),
        // dayColumn('Fr', 'Пт'),
        // dayColumn('Sa', 'Сб'),
        // dayColumn('Su', 'Вс'),
    ];

    return (
        <div className="w-[1400px] mx-auto">
            <Spin spinning={Object.keys(week_reports).length < 1 || authLoading} size="large" fullscreen />
            <ConfigProvider
                theme={{
                    components: {
                        Table: {
                            headerBorderRadius: 0,
                        },
                    },
                }}
            >
                <div className="flex w-full flex-wrap justify-between gap-10">
                    {Object.entries(week_reports).map(([performer, data]) => (
                        <div className="w-full flex-col" key={performer}>
                            <div className="flex h-10 items-center justify-center bg-slate-100 font-bold text-black">
                                {performer}
                            </div>
                            <Table
                                columns={columns}
                                dataSource={data as WeekReportItem[]}
                                size="small"
                                rowKey="_id"
                                pagination={{ pageSize: 5000, hideOnSinglePage: true }}
                            />
                        </div>
                    ))}
                </div>
            </ConfigProvider>
        </div>
    );
};

export default CRMReports;
