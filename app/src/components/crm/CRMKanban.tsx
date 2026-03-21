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
    Empty,
    message,
} from 'antd';
import type { TableColumnType, TableProps } from 'antd';
import cn from 'classnames';
import _ from 'lodash';
import dayjs, { type Dayjs } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import {
    LinkOutlined,
    CommentOutlined,
    CopyOutlined,
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
import { TARGET_TASK_STATUS_LABELS, TARGET_EDITABLE_TASK_STATUS_KEYS, TASK_STATUSES } from '../../constants/crm';
import { getTaskStatusDisplayLabel, matchesTargetTaskStatusKeys, normalizeTargetTaskStatusKey, resolveTaskStatusKey } from '../../utils/taskStatusSurface';
import { NOTION_TICKET_PRIORITIES } from '../../constants/crm';
import { getPerformerLabel, isPerformerSelectable } from '../../utils/performerLifecycle';
import { normalizeVoiceSessionSourceRefs, ticketMatchesVoiceSessionSourceRefs } from '../../utils/voiceSessionTaskSource';
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

const getPerfNow = (): number => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
};

interface CRMKanbanProps {
    filter: {
        task_status?: string[];
        project?: string[];
        epic?: string[];
        title?: string[];
        performer?: string[];
        source_ref?: string[];
    };
    refreshToken?: number;
    draftHorizonDays?: number | undefined;
    columns?: string[];
    column_width?: Record<string, number> | undefined;
    pagination?: boolean | undefined;
}

const CRMKanban = (props: CRMKanbanProps) => {
    const navigate = useNavigate();
    const { isAuth, loading: authLoading } = useAuthStore();
    const {
        tickets,
        ticketsLoading,
        tickets_updated_at,
        performers,
        projects,
        task_types,
        updateTicket,
        createTicket,
        massiveChangeStatus,
        fetchTickets,
        ensureTicketDetails,
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
    } = useCRMStore();

    const { customers, projectGroups, projects: projectsData } = useProjectsStore();
    const [projectGroupFilter, setProjectGroupFilter] = useState<string | null>(null);
    const [projectFilterValues, setProjectFilterValues] = useState<string[]>([]);
    const [selectedRows, setSelectedRows] = useState<string[]>([]);
    const [selectedNewStatus, setSelectedNewStatus] = useState<string | null>(null);
    const tableRef = useRef<HTMLDivElement>(null);
    const lastRenderPerfTicketsUpdatedAtRef = useRef<number | null>(null);

    const getCustomerNameByGroup = useCallback((group: { customer?: string }) => {
        const customer = customers.find(
            (c) => c._id && group.customer && c._id.toString() === group.customer.toString()
        );
        return customer?.name ?? 'Без заказчика';
    }, [customers]);

    const toLookupValue = useCallback((value: unknown): string => {
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return String(value);
        if (!value || typeof value !== 'object') return '';
        const record = value as Record<string, unknown>;
        if (typeof record.$oid === 'string') return record.$oid;
        if (typeof record._id === 'string') return record._id;
        if (typeof record.toString === 'function') {
            const directValue = record.toString();
            if (directValue && directValue !== '[object Object]') return directValue;
        }
        return '';
    }, []);

    const resolveTicketDbId = useCallback((record: Ticket): string => {
        return toLookupValue(record._id).trim();
    }, [toLookupValue]);

    const resolveTicketPublicId = useCallback((record: Ticket): string => {
        return toLookupValue(record.id).trim();
    }, [toLookupValue]);

    const duplicatedPublicTicketIds = useMemo(() => {
        const counts = new Map<string, number>();
        for (const ticket of tickets) {
            const publicId = resolveTicketPublicId(ticket);
            if (!publicId) continue;
            counts.set(publicId, (counts.get(publicId) ?? 0) + 1);
        }

        const duplicates = new Set<string>();
        for (const [publicId, count] of counts.entries()) {
            if (count > 1) duplicates.add(publicId);
        }
        return duplicates;
    }, [resolveTicketPublicId, tickets]);

    const resolveTicketRouteId = useCallback((record: Ticket): string => {
        const dbId = resolveTicketDbId(record);
        if (dbId) return dbId;

        const publicId = resolveTicketPublicId(record);
        if (!publicId || duplicatedPublicTicketIds.has(publicId)) return '';
        return publicId;
    }, [duplicatedPublicTicketIds, resolveTicketDbId, resolveTicketPublicId]);

    const resolveTicketRowKey = useCallback((record: Ticket): string => {
        const dbId = resolveTicketDbId(record);
        if (dbId) return dbId;

        const publicId = resolveTicketPublicId(record);
        const createdAt = toLookupValue(record.created_at).trim();
        const updatedAt = toLookupValue(record.updated_at).trim();
        const name = typeof record.name === 'string' ? record.name.trim() : '';

        return [
            'ticket',
            publicId || 'missing-public-id',
            createdAt || 'missing-created-at',
            updatedAt || 'missing-updated-at',
            name || 'missing-name',
        ].join(':');
    }, [resolveTicketDbId, resolveTicketPublicId, toLookupValue]);

    const getProjectByValue = useCallback((projectValue?: unknown) => {
        const targetValue = toLookupValue(projectValue);
        if (!targetValue) return null;

        return (
            projectsData.find((p) => p._id.toString() === targetValue) ??
            projectsData.find((p) => p.name === targetValue)
        );
    }, [projectsData, toLookupValue]);

    const getProjectInfo = useCallback((project_id?: string | null, project_name?: string | null) => {
        const project = getProjectByValue(project_id) ?? getProjectByValue(project_name);
        if (!project) {
            return project_name || project_id
                ? { project: project_name || project_id, group: 'Unknown', customer: 'Unknown' }
                : null;
        }

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
    }, [customers, getProjectByValue, projectGroups]);

    const getProjectDisplayName = useCallback((record: Ticket): string => {
        const projectData = (record as Ticket & { project_data?: unknown }).project_data;
        const projectDataName =
            projectData &&
            typeof projectData === 'object' &&
            !Array.isArray(projectData) &&
            'name' in projectData &&
            typeof projectData.name === 'string'
                ? projectData.name
                : Array.isArray(projectData)
                  ? projectData.find((item) => item && typeof item.name === 'string' && item.name)
                        ?.name
                  : '';
        return projectDataName || getProjectByValue(record.project_id)?.name || getProjectByValue(record.project)?.name || record.project || '—';
    }, [getProjectByValue]);

    const effectiveStatusFilter = props.filter.task_status ?? statusFilter;

    const requestedStatusFilter = useMemo(() => {
        const nextStatusFilter = effectiveStatusFilter;
        return nextStatusFilter.some((status) => String(status || '').trim() === 'UNKNOWN') ? [] : nextStatusFilter;
    }, [effectiveStatusFilter]);

    const requestedDraftHorizonDays = useMemo(() => {
        return requestedStatusFilter.length === 1 && String(requestedStatusFilter[0] || '').trim() === TASK_STATUSES.DRAFT_10
            ? props.draftHorizonDays
            : undefined;
    }, [props.draftHorizonDays, requestedStatusFilter]);

    useEffect(() => {
        if (isAuth) {
            void fetchTickets(
                requestedStatusFilter,
                {
                    ...(requestedDraftHorizonDays !== undefined ? { draftHorizonDays: requestedDraftHorizonDays } : {}),
                }
            );
        }
    }, [isAuth, requestedStatusFilter, requestedDraftHorizonDays, fetchTickets]);

    const lastRefreshTokenRef = useRef<number>(props.refreshToken ?? 0);

    useEffect(() => {
        if (!isAuth) return;
        const nextRefreshToken = props.refreshToken ?? 0;
        if (nextRefreshToken <= 0 || nextRefreshToken === lastRefreshTokenRef.current) return;
        lastRefreshTokenRef.current = nextRefreshToken;
        void fetchTickets(
            requestedStatusFilter,
            {
                ...(requestedDraftHorizonDays !== undefined ? { draftHorizonDays: requestedDraftHorizonDays } : {}),
            }
        );
    }, [isAuth, props.refreshToken, requestedStatusFilter, requestedDraftHorizonDays, fetchTickets]);

    useEffect(() => {
        const nextStatusFilter = props.filter.task_status ?? [];
        if (_.isEqual(statusFilter, nextStatusFilter)) return;
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

    const isInlineEditing = useCallback(
        (record: Ticket, column: string): boolean => {
            if (!editingColumn.ticket || !editingColumn.column) return false;
            const editingTicketId =
                resolveTicketDbId(editingColumn.ticket) ||
                resolveTicketPublicId(editingColumn.ticket);
            const recordId = resolveTicketDbId(record) || resolveTicketPublicId(record);
            return editingColumn.column === column && editingTicketId === recordId;
        },
        [editingColumn, resolveTicketDbId, resolveTicketPublicId]
    );

    const closeInlineEditor = useCallback(() => {
        setEditingColumn(null, null);
    }, [setEditingColumn]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeInlineEditor();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [closeInlineEditor]);

    const groupedProjectOptions = useMemo(() => {
        const projectsByGroup: Record<string, Array<{ _id: string; name: string }>> = {};

        projectsData.forEach((project) => {
            const group = projectGroups.find(
                (g) =>
                    g._id &&
                    project.project_group &&
                    g._id.toString() === project.project_group.toString()
            );
            const customer = group
                ? customers.find(
                      (c) =>
                          c._id &&
                          group.customer &&
                          c._id.toString() === group.customer.toString()
                  )
                : null;

            const groupKey = group
                ? `${customer?.name ?? 'Unknown'} / ${group.name}`
                : 'Unassigned';

            if (!projectsByGroup[groupKey]) {
                projectsByGroup[groupKey] = [];
            }
            projectsByGroup[groupKey].push({
                _id: project._id,
                name: project.name,
            });
        });

        return Object.entries(projectsByGroup).map(([groupName, values]) => ({
            label: groupName,
            title: groupName,
            options: values.map((value) => ({
                label: value.name,
                value: value._id,
            })),
        }));
    }, [customers, projectGroups, projectsData]);

    const historicalPerformerLabels = useMemo(() => {
        const labels = new Map<string, string>();
        for (const ticket of tickets) {
            const rawPerformer = ticket.performer;
            if (!rawPerformer) continue;

            if (typeof rawPerformer === 'object') {
                const performerRecord = rawPerformer as Performer;
                const performerId = toLookupValue(performerRecord._id) || toLookupValue(performerRecord.id);
                if (!performerId) continue;
                labels.set(performerId, getPerformerLabel(performerRecord, performerId));
                continue;
            }

            const performerId = toLookupValue(rawPerformer);
            if (!performerId) continue;
            if (!labels.has(performerId)) labels.set(performerId, performerId);
        }
        return labels;
    }, [tickets, toLookupValue]);

    const historicalPerformerIds = useMemo(
        () => Array.from(historicalPerformerLabels.keys()),
        [historicalPerformerLabels]
    );

    const performerOptions = useMemo(
        () => {
            const result: Array<{ value: string; label: string }> = [];
            const seen = new Set<string>();
            const historicalPerformerIdSet = new Set(historicalPerformerIds);

            for (const performer of performers) {
                const value = performer._id ?? performer.id;
                if (!value || seen.has(value)) continue;
                if (!isPerformerSelectable(performer) && !historicalPerformerIdSet.has(value)) continue;

                const baseLabel = getPerformerLabel(performer, value);
                const label = !isPerformerSelectable(performer) && historicalPerformerIdSet.has(value)
                    ? `${baseLabel} (архив)`
                    : baseLabel;
                result.push({ value, label });
                seen.add(value);
            }

            for (const performerId of historicalPerformerIds) {
                if (!performerId || seen.has(performerId)) continue;
                result.push({ value: performerId, label: historicalPerformerLabels.get(performerId) ?? performerId });
                seen.add(performerId);
            }

            return result;
        },
        [historicalPerformerIds, historicalPerformerLabels, performers]
    );

    const taskTypeOptions = useMemo(
        () =>
            Object.entries(
                _.groupBy(
                    Object.values(Array.isArray(task_types) ? task_types : []),
                    'supertype'
                )
            ).map(([supertype, groupedTaskTypes]: [string, TaskType[]]) => ({
                label: supertype,
                title: supertype,
                options: groupedTaskTypes.map((tt) => ({
                    label: `${tt.task_id ?? ''} ${tt.name}`,
                    value: tt._id,
                })),
            })),
        [task_types]
    );

    const priorityOptions = useMemo(
        () =>
            NOTION_TICKET_PRIORITIES.map((value) => ({
                value,
                label: value,
            })),
        []
    );

    const statusOptions = useMemo(
        () =>
            TARGET_EDITABLE_TASK_STATUS_KEYS.map((key) => ({
                value: key,
                label: TARGET_TASK_STATUS_LABELS[key],
            })),
        []
    );

    const handleProjectUpdate = useCallback(
        (record: Ticket, projectId: string | null) => {
            if (!projectId) {
                closeInlineEditor();
                return;
            }

            const projectInfo = projectsData.find((project) => project._id === projectId);
            const updatePayload: Partial<Ticket> = {
                project_id: projectId,
                project: projectInfo?.name ?? projectId,
            };
            if (projectInfo) {
                updatePayload.project_data = {
                    _id: projectInfo._id,
                    name: projectInfo.name,
                };
            }
            updateTicket(record, updatePayload);
            closeInlineEditor();
        },
        [closeInlineEditor, projectsData, updateTicket]
    );

    const handleTitleUpdate = useCallback(
        (record: Ticket, nextValue: string) => {
            const normalized = nextValue.trim();
            if (!normalized || normalized === record.name) {
                closeInlineEditor();
                return;
            }

            updateTicket(record, { name: normalized });
            closeInlineEditor();
        },
        [closeInlineEditor, updateTicket]
    );

    const handlePerformerUpdate = useCallback(
        (record: Ticket, performerId: string | null) => {
            if (!performerId) {
                updateTicket(record, { performer: '' });
                closeInlineEditor();
                return;
            }

            const performer =
                performers.find((p) => p._id === performerId || p.id === performerId) ??
                performerId;
            updateTicket(record, { performer });
            closeInlineEditor();
        },
        [closeInlineEditor, performers, updateTicket]
    );

    const handlePriorityUpdate = useCallback(
        (record: Ticket, priority: string | null) => {
            updateTicket(record, { priority: priority ?? '' });
            closeInlineEditor();
        },
        [closeInlineEditor, updateTicket]
    );

    const handleStatusUpdate = useCallback(
        (record: Ticket, taskStatus: string | null) => {
            if (!taskStatus) {
                closeInlineEditor();
                return;
            }
            updateTicket(record, { task_status: taskStatus });
            closeInlineEditor();
        },
        [closeInlineEditor, updateTicket]
    );

    const handleTaskTypeUpdate = useCallback(
        (record: Ticket, taskType: string | null) => {
            updateTicket(record, { task_type: taskType ?? '' });
            closeInlineEditor();
        },
        [closeInlineEditor, updateTicket]
    );

    const handleShipmentDateUpdate = useCallback(
        (record: Ticket, shipmentDate: Dayjs | null) => {
            updateTicket(record, {
                shipment_date: shipmentDate ? shipmentDate.format('YYYY-MM-DD') : '',
            });
            closeInlineEditor();
        },
        [closeInlineEditor, updateTicket]
    );

    const handleCloneTicket = useCallback(
        async (record: Ticket) => {
            const performerId = typeof record.performer === 'object' && record.performer
                ? toLookupValue((record.performer as Performer)._id ?? (record.performer as Performer).id)
                : toLookupValue(record.performer);

            const notifications = Array.isArray(record.notifications)
                ? record.notifications
                    .map((notification) => toLookupValue(notification))
                    .filter((notification): notification is string => Boolean(notification))
                : undefined;

            const normalizedProject = getProjectByValue(record.project_id) ?? getProjectByValue(record.project);
            const projectValue = normalizedProject?._id ?? toLookupValue(record.project_id) ?? record.project;

            const shipmentDate = typeof record.shipment_date === 'string' && dayjs(record.shipment_date).isValid()
                ? dayjs(record.shipment_date).format('YYYY-MM-DD')
                : undefined;

            const estimatedTimeNumeric = Number(record.estimated_time);
            const estimatedTime = Number.isFinite(estimatedTimeNumeric) ? estimatedTimeNumeric : undefined;

            const ticketName = typeof record.name === 'string' ? record.name.trim() : '';

            const clonePayload: Partial<Ticket> = {
                name: `${ticketName || 'Задача'} копия`,
            };

            if (projectValue) clonePayload.project = projectValue;

            const taskTypeValue = toLookupValue(record.task_type);
            if (taskTypeValue) clonePayload.task_type = taskTypeValue;

            if (performerId) clonePayload.performer = performerId;
            if (typeof record.priority === 'string') clonePayload.priority = record.priority;
            if (estimatedTime !== undefined) clonePayload.estimated_time = estimatedTime;
            if (shipmentDate) clonePayload.shipment_date = shipmentDate;

            const epicValue = toLookupValue(record.epic);
            if (epicValue) clonePayload.epic = epicValue;

            if (notifications && notifications.length > 0) clonePayload.notifications = notifications;
            if (typeof record.description === 'string') clonePayload.description = record.description;

            await createTicket(clonePayload);
        },
        [createTicket, getProjectByValue, toLookupValue]
    );

    const withTicketDetails = useCallback(
        async (record: Ticket): Promise<Ticket> => {
            const detailed = await ensureTicketDetails(record);
            return detailed ?? record;
        },
        [ensureTicketDetails]
    );

    const handleOpenComments = useCallback(
        async (record: Ticket) => {
            const detailKey = resolveTicketDbId(record) || resolveTicketPublicId(record) || record.name;
            message.open({ key: `crm-ticket-comments-${detailKey}`, type: 'loading', content: 'Loading ...', duration: 0 });
            try {
                const detailed = await withTicketDetails(record);
                setCommentedTicket(detailed);
            } finally {
                message.destroy(`crm-ticket-comments-${detailKey}`);
            }
        },
        [resolveTicketDbId, resolveTicketPublicId, setCommentedTicket, withTicketDetails]
    );

    const handleOpenWorkHours = useCallback(
        async (record: Ticket) => {
            const detailKey = resolveTicketDbId(record) || resolveTicketPublicId(record) || record.name;
            message.open({ key: `crm-ticket-work-${detailKey}`, type: 'loading', content: 'Loading ...', duration: 0 });
            try {
                const detailed = await withTicketDetails(record);
                setEditingWorkHours(detailed);
            } finally {
                message.destroy(`crm-ticket-work-${detailKey}`);
            }
        },
        [resolveTicketDbId, resolveTicketPublicId, setEditingWorkHours, withTicketDetails]
    );

    const handleOpenEditor = useCallback(
        async (record: Ticket) => {
            const detailKey = resolveTicketDbId(record) || resolveTicketPublicId(record) || record.name;
            message.open({ key: `crm-ticket-edit-${detailKey}`, type: 'loading', content: 'Loading ...', duration: 0 });
            try {
                const detailed = await withTicketDetails(record);
                setEditingTicket(detailed);
            } finally {
                message.destroy(`crm-ticket-edit-${detailKey}`);
            }
        },
        [resolveTicketDbId, resolveTicketPublicId, setEditingTicket, withTicketDetails]
    );

    const rowSelection: TableProps<Ticket>['rowSelection'] = {
        selectedRowKeys: selectedRows,
        onChange: (keys) => {
            setSelectedRows(keys as string[]);
        },
        getCheckboxProps: (record) => ({
            disabled: !resolveTicketDbId(record),
        }),
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
            sorter: (a, b) => compareStrings(getProjectDisplayName(a), getProjectDisplayName(b)),
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
                                setProjectFilterValues([]);
                                close?.();
                                return;
                            }
                            const groupProjects = projectsData.filter(
                                (p) => p.project_group && p.project_group.toString() === value
                            );
                            setProjectFilterValues(groupProjects.map((p) => p.name));
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
                const projectInfo = getProjectInfo(record.project_id, record.project);
                const projectName = getProjectDisplayName(record);
                const currentProject =
                    getProjectByValue(record.project_id) ?? getProjectByValue(record.project);
                const currentProjectValue = currentProject?._id ?? toLookupValue(record.project_id);

                if (isInlineEditing(record, 'project')) {
                    return (
                        <div onClick={(event) => event.stopPropagation()}>
                            <Select
                                autoFocus
                                defaultOpen
                                value={currentProjectValue || null}
                                options={groupedProjectOptions}
                                showSearch
                                filterOption={(inputValue, option) =>
                                    (option?.label ?? '')
                                        .toLowerCase()
                                        .includes(inputValue.toLowerCase())
                                }
                                onChange={(value) =>
                                    handleProjectUpdate(record, String(value))
                                }
                                onOpenChange={(isOpen) => {
                                    if (!isOpen) closeInlineEditor();
                                }}
                                className="w-full min-w-[220px]"
                                popupClassName="w-[380px]"
                                popupMatchSelectWidth={false}
                            />
                        </div>
                    );
                }

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
                        onClick={(event) => {
                            event.stopPropagation();
                            setEditingColumn(record, 'project');
                        }}
                    >
                        {projectName && projectName !== '—' ? (
                            <ProjectTag name={projectName} tooltip={projectInfo?.project ?? projectName} />
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
            render: (_, record) => {
                if (isInlineEditing(record, 'title')) {
                    return (
                        <div onClick={(event) => event.stopPropagation()}>
                            <Input
                                autoFocus
                                defaultValue={record.name}
                                onPressEnter={(event) =>
                                    handleTitleUpdate(record, event.currentTarget.value)
                                }
                                onBlur={(event) =>
                                    handleTitleUpdate(record, event.currentTarget.value)
                                }
                            />
                        </div>
                    );
                }

                return (
                    <div
                        className="flex gap-2 cursor-pointer"
                        onClick={(event) => {
                            event.stopPropagation();
                            setEditingColumn(record, 'title');
                        }}
                    >
                        {record.notion_url ? (
                            <a
                                target="_blank"
                                href={record.notion_url}
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <LinkOutlined />
                            </a>
                        ) : null}
                        <div>{record.name}</div>
                    </div>
                );
            },
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
            filters: performerOptions.map((performer) => ({ text: performer.label, value: performer.value })),
            onFilter: (value, record) => {
                const valueStr = String(value);
                if (typeof record.performer === 'object' && record.performer) {
                    const performerObj = record.performer as Performer;
                    return [performerObj._id, performerObj.id].filter(Boolean).some((id) => String(id) === valueStr);
                }
                const performerRaw = record.performer ? String(record.performer) : '';
                const performerRecord = performers.find(
                    (p) => [p._id, p.id].filter(Boolean).some((id) => String(id) === performerRaw)
                );
                if (performerRecord) {
                    return [performerRecord._id, performerRecord.id]
                        .filter(Boolean)
                        .some((id) => String(id) === valueStr);
                }
                return performerRaw === valueStr;
            },
            defaultFilteredValue: props.filter.performer ?? null,
            filterSearch: true,
            render: (_, record) => {
                const performerInfo =
                    typeof record.performer === 'object'
                        ? (record.performer as Performer)
                        : performers.find((p) => p.id === record.performer || p._id === record.performer);
                const performerValue =
                    typeof record.performer === 'object' && record.performer
                        ? (record.performer as Performer)._id ?? (record.performer as Performer).id
                        : record.performer
                          ? String(record.performer)
                          : undefined;
                const performerFallbackLabel = performerValue ? (historicalPerformerLabels.get(performerValue) ?? performerValue) : '';
                const performerNameWithFallback = performerInfo?.real_name ?? performerInfo?.name ?? performerFallbackLabel;

                if (isInlineEditing(record, 'performer')) {
                    return (
                        <div onClick={(event) => event.stopPropagation()}>
                            <Select
                                autoFocus
                                defaultOpen
                                value={performerValue ?? null}
                                allowClear
                                options={performerOptions}
                                showSearch
                                onChange={(value) =>
                                    handlePerformerUpdate(
                                        record,
                                        value ? String(value) : null
                                    )
                                }
                                onOpenChange={(isOpen) => {
                                    if (!isOpen) closeInlineEditor();
                                }}
                                className="w-[180px]"
                                popupClassName="w-[240px]"
                                popupMatchSelectWidth={false}
                            />
                        </div>
                    );
                }

                return (
                    <div
                        className="flex gap-2 flex-wrap h-[32px] items-center justify-start cursor-pointer"
                        onClick={(event) => {
                            event.stopPropagation();
                            setEditingColumn(record, 'performer');
                        }}
                    >
                        <AvatarName name={performerNameWithFallback} size={28} />
                    </div>
                );
            },
        },
        {
            title: 'Приор',
            key: 'priority',
            width: 80,
            sorter: (a, b) => compareStrings(a.priority, b.priority),
            render: (_, record) => {
                if (isInlineEditing(record, 'priority')) {
                    return (
                        <div onClick={(event) => event.stopPropagation()}>
                            <Select
                                autoFocus
                                defaultOpen
                                value={record.priority ?? null}
                                allowClear
                                options={priorityOptions}
                                onChange={(value) =>
                                    handlePriorityUpdate(
                                        record,
                                        value ? String(value) : null
                                    )
                                }
                                onOpenChange={(isOpen) => {
                                    if (!isOpen) closeInlineEditor();
                                }}
                                popupClassName="w-[120px]"
                                popupMatchSelectWidth={false}
                            />
                        </div>
                    );
                }

                return (
                    <div
                        className="flex gap-2 flex-wrap h-[32px] items-center cursor-pointer"
                        style={{
                            justifyContent: 'center',
                            alignItems: 'start',
                            color: 'black',
                            height: record.priority ? 'auto' : '24px',
                            padding: record.priority ? '4px' : '0px',
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            setEditingColumn(record, 'priority');
                        }}
                    >
                        {record.priority || '🍄'}
                    </div>
                );
            },
        },
        {
            title: 'Статус',
            key: 'task_status',
            sorter: (a, b) => compareStrings(a.task_status, b.task_status),
            width: 180,
            render: (_, record) => {
                if (isInlineEditing(record, 'task_status')) {
                    return (
                        <div onClick={(event) => event.stopPropagation()}>
                            <Select
                                autoFocus
                                defaultOpen
                                value={resolveTaskStatusKey(record.task_status) ?? null}
                                options={statusOptions}
                                showSearch
                                onChange={(value) =>
                                    handleStatusUpdate(
                                        record,
                                        value ? String(value) : null
                                    )
                                }
                                onOpenChange={(isOpen) => {
                                    if (!isOpen) closeInlineEditor();
                                }}
                                className="w-[180px]"
                                popupClassName="w-[220px]"
                                popupMatchSelectWidth={false}
                            />
                        </div>
                    );
                }

                return (
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
                        onClick={(event) => {
                            event.stopPropagation();
                            setEditingColumn(record, 'task_status');
                        }}
                    >
                        {getTaskStatusDisplayLabel(record.task_status)}
                    </div>
                );
            },
        },
        {
            title: 'Тип',
            key: 'task_type',
            sorter: (a, b) => compareTaskTypes(a.task_type, b.task_type),
            width: 140,
            render: (_, record) => {
                const tt = getTaskType(record.task_type);

                if (isInlineEditing(record, 'task_type')) {
                    return (
                        <div onClick={(event) => event.stopPropagation()}>
                            <Select
                                autoFocus
                                defaultOpen
                                value={record.task_type ?? null}
                                allowClear
                                options={taskTypeOptions}
                                showSearch
                                filterOption={(inputValue, option) =>
                                    (option?.label ?? '')
                                        .toString()
                                        .toLowerCase()
                                        .includes(inputValue.toLowerCase())
                                }
                                onChange={(value) =>
                                    handleTaskTypeUpdate(
                                        record,
                                        value ? String(value) : null
                                    )
                                }
                                onOpenChange={(isOpen) => {
                                    if (!isOpen) closeInlineEditor();
                                }}
                                className="w-[140px]"
                                popupClassName="w-[380px]"
                                popupMatchSelectWidth={false}
                            />
                        </div>
                    );
                }

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
                        onClick={(event) => {
                            event.stopPropagation();
                            setEditingColumn(record, 'task_type');
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
            render: (_, record) => {
                if (isInlineEditing(record, 'shipment_date')) {
                    return (
                        <div onClick={(event) => event.stopPropagation()}>
                            <DatePicker
                                autoFocus
                                defaultOpen
                                value={record.shipment_date ? dayjs(record.shipment_date) : null}
                                onChange={(value) =>
                                    handleShipmentDateUpdate(record, value)
                                }
                                onOpenChange={(isOpen) => {
                                    if (!isOpen) closeInlineEditor();
                                }}
                                inputReadOnly
                            />
                        </div>
                    );
                }

                return (
                    <div
                        className="flex gap-2 flex-wrap h-[32px] items-center cursor-pointer"
                        style={{
                            justifyContent: 'center',
                            alignItems: 'start',
                            color: 'black',
                            height: record.shipment_date ? 'auto' : '24px',
                            padding: record.shipment_date ? '4px' : '0px',
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            setEditingColumn(record, 'shipment_date');
                        }}
                    >
                        {record.shipment_date ? dayjs(record.shipment_date).format('DD.MM') : '☠️'}
                    </div>
                );
            },
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
                        <div className="flex items-center gap-1 cursor-pointer justify-center" onClick={() => { void handleOpenWorkHours(record); }}>
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
                    onClick={() => { void handleOpenComments(record); }}
                >
                    <div>
                        {(typeof record.comments_count === 'number' ? record.comments_count : (record.comments_list?.length ?? 0)) > 0 ? (
                            <Badge count={typeof record.comments_count === 'number' ? record.comments_count : (record.comments_list?.length ?? 0)} />
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
            render: (_, record) => {
                const routeTaskId = resolveTicketRouteId(record);
                const dbId = resolveTicketDbId(record);
                const publicId = resolveTicketPublicId(record);
                const hasDuplicatedPublicId = !dbId && Boolean(publicId) && duplicatedPublicTicketIds.has(publicId);

                return (
                    <div className="flex gap-4">
                        <EditOutlined className="hover:text-cyan-500" onClick={() => { void handleOpenEditor(record); }} />
                        <Tooltip title="Клонировать задачу">
                            <CopyOutlined
                                className="hover:text-cyan-500"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void handleCloneTicket(record);
                                }}
                            />
                        </Tooltip>
                        {routeTaskId ? (
                            <a
                                href={`/operops/task/${encodeURIComponent(routeTaskId)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <EyeOutlined className="hover:text-cyan-500" />
                            </a>
                        ) : (
                            <Tooltip
                                title={
                                    hasDuplicatedPublicId
                                        ? 'Невозможно открыть: обнаружен дублирующий short-link, нужен _id'
                                        : 'Невозможно открыть: отсутствует идентификатор задачи'
                                }
                            >
                                <EyeOutlined className="text-slate-300 cursor-not-allowed" />
                            </Tooltip>
                        )}
                    </div>
                );
            },
        },
    ], [
        compareStrings,
        compareTaskTypes,
        getTaskType,
        projectGroupFilter,
        performers,
        historicalPerformerLabels,
        performerOptions,
        groupedProjectOptions,
        epics,
        taskTypeOptions,
        priorityOptions,
        statusOptions,
        props.column_width,
        props.filter,
        getProjectByValue,
        getProjectDisplayName,
        getProjectInfo,
        isInlineEditing,
        closeInlineEditor,
        handleProjectUpdate,
        handleTitleUpdate,
        handlePerformerUpdate,
        handlePriorityUpdate,
        handleStatusUpdate,
        handleTaskTypeUpdate,
        handleShipmentDateUpdate,
        handleCloneTicket,
        handleOpenComments,
        handleOpenEditor,
        handleOpenWorkHours,
        setProjectGroupFilter,
        setEditingColumn,
        setEditingTicket,
        setEditingWorkHours,
        setCommentedTicket,
        ensureTicketDetails,
        resolveTicketDbId,
        resolveTicketPublicId,
        resolveTicketRouteId,
        duplicatedPublicTicketIds,
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
        recalulateStatusesStat();
    }, [tickets, recalulateStatusesStat]);

    const hasUnknownStatusFilter = effectiveStatusFilter.some((status) => String(status || '').trim() === 'UNKNOWN');
    const selectedTargetStatusKeys = effectiveStatusFilter
        .filter((status) => String(status || '').trim() !== 'UNKNOWN')
        .map((status) => normalizeTargetTaskStatusKey(status))
        .filter((status): status is NonNullable<typeof status> => Boolean(status));
    let filteredTickets = tickets.filter((record) => {
        const matchesKnownStatus = matchesTargetTaskStatusKeys(record.task_status, selectedTargetStatusKeys);
        if (matchesKnownStatus) return true;
        if (!hasUnknownStatusFilter) return false;
        return normalizeTargetTaskStatusKey(record.task_status) === null;
    });
    if (projectFilterValues.length > 0) {
        filteredTickets = filteredTickets.filter((record) =>
            projectFilterValues.includes(getProjectDisplayName(record))
        );
    }
    const sourceRefFilterValues = normalizeVoiceSessionSourceRefs(props.filter.source_ref ?? []);
    if (sourceRefFilterValues.length > 0) {
        filteredTickets = filteredTickets.filter((record) =>
            ticketMatchesVoiceSessionSourceRefs(record, sourceRefFilterValues)
        );
    }

    useEffect(() => {
        if (!isAuth || ticketsLoading || tickets_updated_at === null) return;
        if (lastRenderPerfTicketsUpdatedAtRef.current === tickets_updated_at) return;
        lastRenderPerfTicketsUpdatedAtRef.current = tickets_updated_at;

        let renderAfterFetchMs: number;
        if (
            typeof performance !== 'undefined' &&
            typeof performance.now === 'function' &&
            typeof performance.timeOrigin === 'number'
        ) {
            const fetchCompletedAtPerfNow = tickets_updated_at - performance.timeOrigin;
            renderAfterFetchMs = getPerfNow() - fetchCompletedAtPerfNow;
        } else {
            renderAfterFetchMs = Date.now() - tickets_updated_at;
        }

        console.info('[crm.perf] tickets.render.after_fetch', {
            render_after_fetch_ms: roundTo(Math.max(0, renderAfterFetchMs), 2),
            tickets_count: tickets.length,
            filtered_tickets_count: filteredTickets.length,
            tickets_updated_at,
        });
    }, [isAuth, ticketsLoading, tickets_updated_at, tickets.length, filteredTickets.length]);

    const isTableLoading = authLoading || ticketsLoading;

    return (
        <div className="crm-kanban w-full max-w-[1232px] 2xl:max-w-[1724px] mx-auto overflow-x-auto">
            <Spin spinning={authLoading} size="large" fullscreen />

            {selectedRows.length > 0 ? (
                <div className="flex justify-end mb-4">
                    <div className="flex gap-4 items-center">
                        <div>Выбрано задач: {selectedRows.length}</div>
                        <Select
                            options={statusOptions}
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
                    loading={false}
                    size="small"
                    scroll={{ x: 'max-content' }}
                    rowKey={(record) => resolveTicketRowKey(record)}
                    rowClassName={(record) => (record.status_update_checked === false ? 'row-unchecked-status' : '')}
                    onRow={(record) => ({
                        onClick: () => {
                            if (!record.status_update_checked) updateTicket(record, { status_update_checked: true }, { silent: true });
                        },
                    })}
                    pagination={props.pagination ? { pageSize: 100 } : false}
                    locale={{
                        emptyText: isTableLoading ? 'Loading ...' : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />,
                    }}
                    onChange={(pagination, filters, sorter, extra) => {
                        if (extra.action === 'filter') {
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
