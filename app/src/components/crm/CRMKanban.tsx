import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Table,
    Spin,
    Button,
    ConfigProvider,
    Input,
    Select,
    Popover,
    Tooltip,
    DatePicker,
    Space,
    Badge,
    Modal,
    Divider,
    Tag,
} from 'antd';
import type { TableColumnType, TableProps } from 'antd';
import cn from 'classnames';
import _ from 'lodash';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import {
    LinkOutlined,
    CommentOutlined,
    PlusOutlined,
    SearchOutlined,
    EditOutlined,
    ExclamationCircleFilled,
    QuestionCircleFilled,
    DislikeOutlined,
    LikeOutlined,
    CheckCircleOutlined,
    StopOutlined,
    BellOutlined,
    EyeOutlined,
    FilterOutlined,
    ClockCircleOutlined,
    TeamOutlined,
} from '@ant-design/icons';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import { useProjectsStore } from '../../store/projectsStore';
import { useAuthStore } from '../../store/authStore';
import { TASK_STATUSES } from '../../constants/crm';
import type { Ticket, Performer, Epic, TaskType } from '../../types/crm';

import AvatarName from './AvatarName';
import ProjectTag from './ProjectTag';
import CommentsSidebar from './CommentsSidebar';
import WorkHoursSidebar from './WorkHoursSidebar';

dayjs.extend(relativeTime);

const roundTo = (value: number, precision = 0): number => {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
};

interface CRMKanbanProps {
    filter: {
        task_status?: string[];
        project?: string[];
        epic?: string[];
        title?: string[];
        performer?: string[];
    };
    columns?: string[];
    column_width?: Record<string, number> | undefined;
    pagination?: boolean | undefined;
}

const CRMKanban = (props: CRMKanbanProps) => {
    const navigate = useNavigate();
    const debugCRM = import.meta.env.VITE_DEBUG_CRM === 'true';
    const { isAuth, loading: authLoading } = useAuthStore();
    const {
        tickets,
        performers,
        projects,
        task_types,
        updateTicket,
        massiveChangeStatus,
        fetchTickets,
        fetchDictionary,
        getCustomerByProject,
        getProjectEpics,
        getProjectByName,
        epics,
        createEpic,
    } = useKanbanStore();

    const {
        editingColumn,
        setEditingColumn,
        setEditingTicketToNew,
        editingTicket,
        setEditingTicket,
        statusFilter,
        setStatusFilter,
        savedFilters,
        saveFilters,
        all_statuses_stat,
        calculateStatusesStat,
        setCommentedTicket,
        setEditingWorkHours,
        approveModalOpen,
        setApproveModalOpen,
        projectFilter,
        setProjectFilter,
    } = useCRMStore();

    const { customers, projectGroups, projects: projectsData } = useProjectsStore();
    const [projectGroupFilter, setProjectGroupFilter] = useState<string | null>(null);
    const [selectedRows, setSelectedRows] = useState<string[]>([]);
    const [selectedNewStatus, setSelectedNewStatus] = useState<string | null>(null);
    const tableRef = useRef<HTMLDivElement>(null);

    const getCustomerNameByGroup = (group: { customer?: string }) => {
        const customer = customers.find(
            (c) => c._id && group.customer && c._id.toString() === group.customer.toString()
        );
        return customer?.name ?? 'Без заказчика';
    };

    const getProjectInfo = (project_id: string | undefined) => {
        if (!project_id) return null;

        const project = projectsData.find((p) => p._id.toString() === project_id.toString());
        if (!project) return { project: project_id, group: 'Unknown', customer: 'Unknown' };

        const group = projectGroups.find(
            (g) => g._id && project.project_group && g._id.toString() === project.project_group.toString()
        );
        const customer = group
            ? customers.find((c) => c._id && group.customer && c._id.toString() === group.customer.toString())
            : null;

        return {
            project: project.name,
            group: group?.name ?? 'Unassigned',
            customer: customer?.name ?? 'Unknown',
        };
    };

    useEffect(() => {
        if (isAuth) {
            if (tickets.length < 1) {
                if (debugCRM) {
                    console.debug('[CRMKanban] fetchTickets on mount', {
                        statusFilter: props.filter.task_status ?? [],
                        ticketsLength: tickets.length,
                    });
                }
                fetchTickets(props.filter.task_status ?? []);
            }
        }
    }, [isAuth, tickets.length, props.filter.task_status, fetchTickets]);

    useEffect(() => {
        const nextStatusFilter = props.filter.task_status ?? [];
        if (_.isEqual(statusFilter, nextStatusFilter)) return;
        if (debugCRM) {
            console.debug('[CRMKanban] setStatusFilter', {
                prev: statusFilter,
                next: nextStatusFilter,
            });
        }
        setStatusFilter(nextStatusFilter);
    }, [props.filter.task_status, statusFilter, setStatusFilter]);

    const compareStrings = useCallback((a: string | undefined | null, b: string | undefined | null) => {
        if (_.isEmpty(a) && _.isEmpty(b)) return 0;
        if (_.isEmpty(a) && !_.isEmpty(b)) return 1;
        if (!_.isEmpty(a) && _.isEmpty(b)) return -1;
        return (a ?? '').localeCompare(b ?? '');
    }, []);

    const getTaskType = useCallback((id: string | undefined): TaskType | undefined => {
        if (!id) return undefined;
        const taskTypes = task_types ?? [];
        return taskTypes.find((t) => t._id === id || t.task_id === id);
    }, [task_types]);

    const compareTaskTypes = useCallback((a: string | undefined, b: string | undefined) => {
        const ta = getTaskType(a);
        const tb = getTaskType(b);
        if (_.isEmpty(ta) && _.isEmpty(tb)) return 0;
        if (_.isEmpty(ta) && !_.isEmpty(tb)) return 1;
        if (!_.isEmpty(ta) && _.isEmpty(tb)) return -1;
        const na = `${ta?.supertype ?? ''}: ${ta?.name ?? ''}`;
        const nb = `${tb?.supertype ?? ''}: ${tb?.name ?? ''}`;
        return na.localeCompare(nb);
    }, [getTaskType]);

    const rowSelection: TableProps<Ticket>['rowSelection'] = {
        selectedRowKeys: selectedRows,
        onChange: (keys) => {
            setSelectedRows(keys as string[]);
        },
    };

    const columns = useMemo<TableColumnType<Ticket>[]>(() => [
        {
            title: 'Дата',
            key: 'created_at',
            width: 60,
            render: (_, record) => (
                <div className="flex flex-col relative">
                    <div className="text-[12px]">{dayjs(record.created_at).format('DD.MM')}</div>
                </div>
            ),
        },
        {
            title: '',
            key: 'notification',
            width: 24,
            render: (_, record) =>
                record.notifications && Array.isArray(record.notifications) && (record.notifications as string[]).length > 0 ? (
                    <Tooltip
                        title={(record.notifications as string[])
                            .map((n) => performers.find((p) => p._id === n)?.name)
                            .filter(Boolean)
                            .join('\n')}
                    >
                        <BellOutlined className="hover:text-cyan-500" />
                    </Tooltip>
                ) : null,
        },
        {
            title: '',
            key: 'mark',
            width: 8,
            render: (_, record) =>
                record.last_status_update && Date.now() - (record.last_status_update ?? 0) < 16 * 60 * 60 * 1000 ? (
                    <div className="w-[2px] h-[32px] bg-blue-500 rounded-full -translate-x-2" />
                ) : null,
        },
        {
            title: 'Upd',
            key: 'updated_at',
            width: 60,
            render: (_, record) => (
                <div className="flex flex-col">
                    <div className="text-[12px]">{dayjs(record.updated_at).format('DD.MM')}</div>
                    <div className="text-[10px]">{dayjs(record.updated_at).format('HH:mm')}</div>
                </div>
            ),
            sorter: (a, b) => dayjs(a.updated_at).unix() - dayjs(b.updated_at).unix(),
        },
        {
            title: 'Проект',
            key: 'project',
            width: 120,
            sorter: (a, b) => compareStrings(a?.project_data?.name, b?.project_data?.name),
            filterDropdown: ({ close }) => (
                <div className="p-2 w-[260px]">
                    <Select
                        options={projectGroups.map((group) => ({
                            value: group._id,
                            label: `${group.name} (${getCustomerNameByGroup(group)})`,
                        }))}
                        showSearch
                        value={projectGroupFilter}
                        onChange={(value) => {
                            setProjectGroupFilter(value ?? null);
                            if (!value) {
                                setProjectFilter([]);
                                close?.();
                                return;
                            }
                            const groupProjects = projectsData.filter(
                                (p) => p.project_group && p.project_group.toString() === value
                            );
                            setProjectFilter(groupProjects.map((p) => p.name));
                            close?.();
                        }}
                        placeholder="Выберите группу"
                        allowClear
                        className="w-full"
                    />
                </div>
            ),
            filterIcon: () => <FilterOutlined style={{ color: projectGroupFilter ? '#1677ff' : undefined }} />,
            render: (_, record) => {
                const projectInfo = getProjectInfo(record.project_id);
                return (
                    <div
                        className="flex flex-col cursor-pointer"
                        style={{
                            justifyContent: 'center',
                            alignItems: 'start',
                            color: 'black',
                            height: projectInfo ? 'auto' : '48px',
                            padding: projectInfo ? '4px' : '0px',
                        }}
                    >
                        {record.project ? (
                            <ProjectTag name={record?.project_data?.name ?? record.project} tooltip={projectInfo?.project ?? record.project} />
                        ) : (
                            <ProjectTag />
                        )}
                    </div>
                );
            },
        },
        {
            title: 'Эпик',
            key: 'epic',
            width: 200,
            sorter: (a, b) => compareStrings(a.epic, b.epic),
            filters: epics
                ? Object.values(epics)
                    .filter((epic) => !epic.is_deleted)
                    .map((epic) => ({ text: `${epic.name} (${epic.project_name ?? ''})`, value: epic._id }))
                : [],
            onFilter: (value, record) => record.epic === value,
            defaultFilteredValue: props.filter.epic ?? null,
            filterSearch: true,
            render: (_, record) => {
                const epicName = record.epic && epics ? epics[record.epic]?.name : undefined;
                return (
                    <div className="flex gap-2 flex-wrap items-center justify-start">
                        {epicName ?? <div className="h-8 w-full hover:bg-slate-300" />}
                    </div>
                );
            },
        },
        {
            title: 'Задача',
            key: 'title',
            width: props.column_width?.['title'] ?? 360,
            defaultFilteredValue: props.filter.title ?? null,
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, close }) => (
                <div className="p-2" onKeyDown={(e) => e.stopPropagation()}>
                    <Input
                        placeholder="Поиск по названию"
                        value={selectedKeys[0]}
                        onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                        onPressEnter={() => confirm()}
                        className="mb-2 block"
                    />
                    <div className="flex justify-between items-center">
                        <Button type="primary" onClick={() => confirm()} icon={<SearchOutlined />} size="small" className="w-[90px]">
                            Поиск
                        </Button>
                        <Button type="link" size="small" onClick={() => close()}>
                            закрыть
                        </Button>
                    </div>
                </div>
            ),
            filterIcon: (filtered) => <SearchOutlined style={{ color: filtered ? '#1677ff' : undefined }} />,
            onFilter: (value, record) => record.name.toString().toLowerCase().includes(String(value).toLowerCase()),
            render: (_, record) => (
                <div className="flex gap-2 cursor-pointer" onClick={() => setEditingColumn(record, 'title')}>
                    {record.notion_url ? (
                        <a target="_blank" href={record.notion_url} rel="noopener noreferrer">
                            <LinkOutlined />
                        </a>
                    ) : null}
                    <div>{record.name}</div>
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Исполнитель" placement="top">
                    <TeamOutlined />
                </Tooltip>
            ),
            key: 'performer',
            width: props.column_width?.['performer'] ?? 80,
            sorter: (a, b) => {
                const aName = typeof a.performer === 'object' ? (a.performer as Performer)?.name : '';
                const bName = typeof b.performer === 'object' ? (b.performer as Performer)?.name : '';
                return compareStrings(aName, bName);
            },
            filters: performers.map((performer) => ({ text: performer.name, value: performer.id ?? performer._id })),
            onFilter: (value, record) => {
                const perfId = typeof record.performer === 'object' ? (record.performer as Performer)?.id : record.performer;
                return perfId === value;
            },
            defaultFilteredValue: props.filter.performer ?? null,
            filterSearch: true,
            render: (_, record) => {
                const performerInfo =
                    typeof record.performer === 'object'
                        ? (record.performer as Performer)
                        : performers.find((p) => p.id === record.performer || p._id === record.performer);
                const performerName = performerInfo?.real_name ?? performerInfo?.name ?? '';
                return (
                    <div className="flex gap-2 flex-wrap h-[32px] items-center justify-start cursor-pointer">
                        <AvatarName name={performerName} size={28} />
                    </div>
                );
            },
        },
        {
            title: 'Приор',
            key: 'priority',
            width: 80,
            sorter: (a, b) => compareStrings(a.priority, b.priority),
            render: (_, record) => (
                <div
                    className="flex gap-2 flex-wrap h-[32px] items-center cursor-pointer"
                    style={{
                        justifyContent: 'center',
                        alignItems: 'start',
                        color: 'black',
                        height: record.priority ? 'auto' : '24px',
                        padding: record.priority ? '4px' : '0px',
                    }}
                >
                    {record.priority || '🍄'}
                </div>
            ),
        },
        {
            title: 'Статус',
            key: 'task_status',
            sorter: (a, b) => compareStrings(a.task_status, b.task_status),
            width: 180,
            render: (_, record) => (
                <div
                    className="flex gap-2 flex-wrap h-[32px] items-center cursor-pointer"
                    style={{
                        alignItems: 'center',
                        justifyContent: 'start',
                        color: 'black',
                        fontSize: 12,
                        height: record.task_status ? 'auto' : '24px',
                        padding: record.task_status ? '4px' : '0px',
                    }}
                >
                    {record.task_status}
                </div>
            ),
        },
        {
            title: 'Тип',
            key: 'task_type',
            sorter: (a, b) => compareTaskTypes(a.task_type, b.task_type),
            width: 140,
            render: (_, record) => {
                const tt = getTaskType(record.task_type);
                return (
                    <div
                        className="flex gap-2 flex-wrap h-[32px] cursor-pointer"
                        style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.2)',
                            alignItems: 'center',
                            justifyContent: 'start',
                            color: 'black',
                            height: record.task_type ? 'auto' : '24px',
                            padding: record.task_type ? '4px' : '0px',
                        }}
                    >
                        {tt ? (
                            <Tooltip placement="top" title={tt.long_name ?? tt.name}>
                                <Tag className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap bg-slate-100 border-slate-200 text-slate-700">
                                    {tt.name ?? tt.task_id ?? ''}
                                </Tag>
                            </Tooltip>
                        ) : (
                            <Tag className="bg-slate-100 border-slate-200 text-slate-400">—</Tag>
                        )}
                    </div>
                );
            },
        },
        {
            title: 'Upload',
            key: 'shipment_date',
            width: 72,
            sorter: (a, b) => dayjs(a.shipment_date ?? '').unix() - dayjs(b.shipment_date ?? '').unix(),
            render: (_, record) => (
                <div
                    className="flex gap-2 flex-wrap h-[32px] items-center cursor-pointer"
                    style={{
                        justifyContent: 'center',
                        alignItems: 'start',
                        color: 'black',
                        height: record.shipment_date ? 'auto' : '24px',
                        padding: record.shipment_date ? '4px' : '0px',
                    }}
                >
                    {record.shipment_date ? dayjs(record.shipment_date).format('DD.MM') : '☠️'}
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="План / факт" placement="top">
                    <ClockCircleOutlined />
                </Tooltip>
            ),
            key: 'plan_fact',
            width: props.column_width?.['plan_fact'] ?? 70,
            sorter: (a, b) => (parseFloat(String(a.total_hours)) || 0) - (parseFloat(String(b.total_hours)) || 0),
            render: (_, record) => {
                const planValue = parseFloat(String(record.estimated_time)) || 0;
                const factValue = roundTo(parseFloat(String(record.total_hours)) || 0, 1);
                const est = parseFloat(String(record.estimated_time));
                const tot = parseFloat(String(record.total_hours));
                const show_alert = Number.isFinite(est) && Number.isFinite(tot) && est > 0 && tot > 0 && tot - est > 0.5;

                return (
                    <div className="flex flex-col items-center justify-center gap-1">
                        <div className="flex items-center justify-center min-h-[18px] text-[12px] text-[#111827] cursor-pointer hover:bg-slate-200 px-1 rounded">
                            {planValue}
                        </div>
                        <div className="flex items-center gap-1 cursor-pointer justify-center" onClick={() => setEditingWorkHours(record)}>
                            {show_alert ? <ExclamationCircleFilled className="text-red-800" /> : null}
                            <div className={`text-[12px] ${show_alert ? 'text-red-800' : 'text-[#111827]'}`}>{factValue}</div>
                        </div>
                    </div>
                );
            },
        },
        {
            title: <CommentOutlined />,
            key: 'dashboard_comment',
            render: (_, record) => (
                <div
                    className="flex gap-2 cursor-pointer hover:bg-[#3086FF]/30 justify-center items-center h-[30px]"
                    onClick={() => setCommentedTicket(record)}
                >
                    <div>
                        {record.comments_list && record.comments_list.length > 0 ? (
                            <Badge count={record.comments_list.length} />
                        ) : (
                            <div className="h-4" />
                        )}
                    </div>
                </div>
            ),
        },
        {
            title: '',
            key: 'edit_action',
            render: (_, record) => (
                <div className="flex gap-4">
                    <EditOutlined className="hover:text-cyan-500" onClick={() => setEditingTicket(record)} />
                    <a href={`/task/${record.id}`} target="_blank" rel="noopener noreferrer">
                        <EyeOutlined className="hover:text-cyan-500" />
                    </a>
                </div>
            ),
        },
    ], [
        compareStrings,
        compareTaskTypes,
        getTaskType,
        customers,
        projectGroups,
        projectGroupFilter,
        projectsData,
        performers,
        epics,
        task_types,
        props.column_width,
        props.filter,
        setProjectFilter,
        setProjectGroupFilter,
        setEditingColumn,
        setEditingTicket,
        setEditingWorkHours,
        setCommentedTicket,
        setApproveModalOpen,
    ]);

    const normalizeColumnKeys = (keys: string[]) => {
        const planKeys = ['estimated_time', 'estimated_time_edit', 'total_hours'];
        const result: string[] = [];
        for (const key of keys) {
            if (key === 'epic') continue;
            if (planKeys.includes(key)) {
                if (!result.includes('plan_fact')) result.push('plan_fact');
                continue;
            }
            if (!result.includes(key)) result.push(key);
        }
        return result;
    };

    const rawColumnKeys = useMemo(() => props.columns ?? columns.map((column) => column.key as string), [props.columns, columns]);
    const normalizedColumnKeys = useMemo(() => normalizeColumnKeys(rawColumnKeys), [rawColumnKeys]);
    const filteredColumns = useMemo(
        () => columns.filter((c) => normalizedColumnKeys.includes(c.key as string)),
        [columns, normalizedColumnKeys]
    );

    const recalulateStatusesStat = useCallback(() => {
        let true_filtered_data = tickets;
        for (const column of filteredColumns) {
            if (column.defaultFilteredValue && column.onFilter) {
                for (const value of column.defaultFilteredValue) {
                    true_filtered_data = true_filtered_data.filter((record) => column.onFilter!(value, record));
                }
            }
        }
        calculateStatusesStat(true_filtered_data);
    }, [tickets, filteredColumns, calculateStatusesStat]);

    useEffect(() => {
        if (debugCRM) {
            console.debug('[CRMKanban] recalulateStatusesStat', {
                ticketsLength: tickets.length,
                filteredColumns: filteredColumns.map((c) => c.key),
            });
        }
        recalulateStatusesStat();
    }, [tickets, recalulateStatusesStat]);

    const statusFilterLabels = statusFilter.map((status) => {
        const key = status as keyof typeof TASK_STATUSES;
        return key in TASK_STATUSES ? TASK_STATUSES[key] : null;
    });
    let filteredTickets = tickets.filter((record) => statusFilterLabels.includes(record.task_status as typeof statusFilterLabels[number]));
    if (projectFilter && projectFilter.length > 0) {
        filteredTickets = filteredTickets.filter((record) => projectFilter.includes(record.project));
    }

    return (
        <div className="crm-kanban w-full max-w-[1232px] 2xl:max-w-[1724px] mx-auto overflow-x-auto">
            <Spin spinning={tickets.length < 1 || authLoading} size="large" fullscreen />

            {selectedRows.length > 0 ? (
                <div className="flex justify-end mb-4">
                    <div className="flex gap-4 items-center">
                        <div>Выбрано задач: {selectedRows.length}</div>
                        <Select
                            options={Object.values(TASK_STATUSES).map((value) => ({ value, label: value }))}
                            onSelect={setSelectedNewStatus}
                            showSearch
                            className="w-[180px]"
                        />
                        <Button
                            onClick={() => {
                                if (!selectedNewStatus) return;
                                massiveChangeStatus(selectedRows, selectedNewStatus);
                                setSelectedRows([]);
                            }}
                        >
                            Изменить статус
                        </Button>
                    </div>
                </div>
            ) : null}
            <ConfigProvider
                theme={{
                    components: {
                        Table: {
                            headerBorderRadius: 0,
                            cellFontSizeSM: 12,
                        },
                    },
                }}
            >
                <Table
                    sticky
                    columns={filteredColumns}
                    dataSource={filteredTickets}
                    size="small"
                    scroll={{ x: 'max-content' }}
                    rowKey="_id"
                    rowClassName={(record) => (record.status_update_checked === false ? 'row-unchecked-status' : '')}
                    onRow={(record) => ({
                        onClick: () => {
                            if (!record.status_update_checked) updateTicket(record, { status_update_checked: true }, { silent: true });
                        },
                    })}
                    pagination={props.pagination ? { pageSize: 100 } : false}
                    onChange={(pagination, filters, sorter, extra) => {
                        if (extra.action === 'filter') {
                            if (debugCRM) {
                                console.debug('[CRMKanban] table filter change', {
                                    filters,
                                    sorter,
                                    pagination,
                                });
                            }
                            saveFilters(filters as Record<string, (string | boolean)[] | null>);
                            recalulateStatusesStat();
                        }
                    }}
                    rowSelection={rowSelection}
                />
                <CommentsSidebar />
                <WorkHoursSidebar />
            </ConfigProvider>
        </div>
    );
};

export default CRMKanban;
