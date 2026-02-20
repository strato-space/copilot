/**
 * Kanban Store - Data and operations for CRM Kanban board
 * Migrated from appkanban/src/store/kanban.js
 */

import { create } from 'zustand';
import update from 'immutability-helper';
import _ from 'lodash';
import sanitizeHtml from 'sanitize-html';
import type { Dayjs } from 'dayjs';

import { useRequestStore } from './requestStore';
import { useCRMStore } from './crmStore';
import { TASK_STATUSES, TASK_CLASSES } from '../constants/crm';
import type {
    Ticket,
    Performer,
    Project,
    Customer,
    ProjectGroup,
    TreeNode,
    TaskType,
    TaskSupertype,
    Epic,
    IncomeType,
    DictionaryResponse,
    WorkData,
    ExpenseRecord,
    IncomeRecord,
    BotCommand,
} from '../types/crm';

interface WidgetsData {
    expenses: ExpenseRecord[];
    income: IncomeRecord[];
    works: WorkData[];
    performers_by__id: Record<string, Performer>;
}

interface CalculatedWidgetsData {
    s_expenses: number;
    s_income: number;
    s_margin: number;
    real_s_work_hours: number;
    total_s_work_hours: number;
    selled_s_work_hours: number;
    by_performers: Record<string, { p_income: number; p_expenses: number; p_margin: number }>;
}

interface PaymentTreeNode {
    type: string;
    title: string;
    key: string;
    children?: PaymentTreeNode[];
    performer_id?: string | undefined;
    document_url?: string | undefined;
    edit_url?: string | undefined;
    parent_title?: string | undefined;
}

interface BonusResult {
    k_hours: number;
    k_review: number;
    k_speed: number;
    payment: number;
    basicBonus: number;
    customBonus: number | undefined;
    bonus: number;
    total: number;
    taxed: number | null;
    taxCompensation: number | null;
}

interface PerformerStats {
    totalWorkHours: number;
    daysBelowANormal: number;
    totalDaysWithWork: number;
    averageReviewsCount: number;
    ticketWithReviewCount: number;
    ticketsAboveNormalTimeBetweenReadyAndReview: number;
}

interface PaymentData {
    payment_type: 'hourly' | 'monthly';
    hourly_rate?: number;
    monthly_rate?: number;
    custom_bonus?: number;
    tax?: number;
}

interface KanbanState {
    // Filters
    statusesFilter: string[];
    setStatusesFilter: (statuses: string[]) => void;

    // Helpers
    getCustomerByProject: (project: string) => string;
    getProjectGroupByProject: (project: string) => string;

    // Data
    tickets: Ticket[];
    tickets_updated_at: number | null;
    boards: string[];
    customers: Customer[];
    projectGroups: ProjectGroup[];
    income_types: IncomeType[];
    task_types: TaskType[];
    task_supertypes: TaskSupertype[];
    task_types_tree: TreeNode[];
    tree: TreeNode[];
    saveTree: (tree: TreeNode[]) => void;
    performers: Performer[];
    setPayment: (performer: Performer, payments: string) => void;
    projects: string[];
    projectsData: Project[];
    epics: Record<string, Epic> | null;

    // Fetch operations
    fetchTickets: (statuses?: string[]) => Promise<void>;
    fetchTicketById: (ticket_id: string) => Promise<Ticket | null>;
    fetchDictionary: () => Promise<void>;

    // CRUD operations
    moveNode: (node: TreeNode, destination: TreeNode) => void;
    saveProject: (project: Project, projectGroup: string) => Promise<void>;
    saveCustomer: (customer: Customer) => Promise<void>;
    saveProjectGroup: (projectGroup: ProjectGroup, customer?: string) => Promise<void>;

    updateTicket: (ticket: Ticket, updateProps: Partial<Ticket>, opt?: { silent?: boolean }) => Promise<void>;
    editTicketData: (ticket: Ticket) => Promise<void>;
    deleteTicket: (ticket_id: string) => Promise<void>;
    createTicket: (values: Partial<Ticket>) => Promise<void>;

    // Comments
    saveComment: (ticket: Ticket, comment_text: string) => Promise<void>;

    // File upload
    uploadFile: (file: File) => Promise<string>;

    // Bulk operations
    massiveChangeStatus: (tickets: string[], new_status: string) => Promise<void>;

    // Work hours
    addWorkHours: (data: { ticket_id: string; date: Dayjs; time: number; description?: string }) => Promise<void>;
    editWorkHour: (data: { _id: string; ticket_id: string; date: Dayjs; time: number; description?: string }) => Promise<void>;

    // Figma / Design
    getDesignSections: (figma_file_url: string) => Promise<void>;
    fileDesignSections: unknown[];
    projectFilesList: unknown[];
    getProjectFiles: (selectedNode: TreeNode) => Promise<void>;
    clearProjectFiles: () => void;
    startSync: (pair: unknown, sectionsToSync: unknown) => Promise<void>;

    // Project helpers
    getProjectByName: (project_name: string) => Project | undefined;
    getProjectEpics: (project_name: string) => Epic[];

    // Epics
    createEpic: (values: Partial<Epic>) => Promise<void>;
    editEpic: (epic: Epic) => Promise<void>;
    deleteEpic: (epic: Epic) => Promise<void>;

    // Finances
    fetchExpensesData: () => Promise<void>;
    savePayments: () => Promise<void>;
    incomeData: IncomeRecord[] | null;
    fetchIncomeData: () => Promise<void>;
    saveIncomeRow: (value: IncomeRecord) => Promise<void>;
    deleteIncomeRow: () => Promise<void>;
    performersMarginData: unknown[];
    fetchPeformersMarginData: () => Promise<void>;
    projectsMarginData: unknown[];
    fetchProjectsMarginData: () => Promise<void>;

    // Month work hours
    monthWorkHours: number | null;
    setMonthWorkHours: (value: number | null) => void;
    saveMonthWorkHours: () => Promise<void>;
    fetchMonthWorkHours: () => Promise<void>;

    // Widgets
    widgetsActualProjects: Array<{ name: string; full_name: string }>;
    widgetsData: WidgetsData | null;
    fetchMetricsWidgets: () => Promise<void>;
    widgetsProjectsFilter: string[];
    setWidgetsProjectsFilter: (d: string[]) => void;
    widgetsPerformersFilter: string[];
    setWidgetsPerformersFilter: (d: string[]) => void;
    calculadetWidgetsData: CalculatedWidgetsData | null;
    calculateWidgets: () => void;

    // Bot commands
    botCommands: BotCommand[] | null;
    fetchBotCommands: () => Promise<void>;
    saveBotCommand: (command: BotCommand) => Promise<void>;
    deleteBotCommand: (command_id: string) => Promise<void>;
    testResult: unknown[];
    testBotCommand: (command: BotCommand, text: string) => Promise<void>;

    // Roadmaps
    roadmap: Epic[] | null;
    fetchRoadmap: (project_id: string) => Promise<void>;

    // Task types
    taskTypesTree: TaskType[] | null;
    fetchTaskTypes: () => Promise<void>;
    saveTaskType: (task_type: TaskType) => Promise<void>;
    saveFunctionality: (functionality: TaskType) => Promise<TaskType>;

    // Performer finances
    performerFinancesData: unknown | null;
    fetchPerfrormerFinances: (performer_id: string) => Promise<void>;

    // Payments tree
    performersPaymentsTree: PaymentTreeNode[] | null;
    fetchPerformersPaymentsTree: () => Promise<void>;

    // Bonus calculation
    calculateBonus: (stats: PerformerStats, paymentData: PaymentData) => BonusResult;
    createPayment: (performer_id: string, works: unknown, stats: PerformerStats, paymentData: PaymentData) => Promise<unknown>;

    // Performers data
    performersData: unknown[];
    fetchPerformersData: () => Promise<void>;
    savePaymentsSettings: (settings: unknown, performer_id: string) => Promise<void>;

    // Warehouse
    warehouseTree: unknown | null;
    fetchWarehouseTree: () => Promise<void>;

    // Import
    importFromGoogleSheets: (spreadsheet_url: string) => Promise<unknown>;
}

export const useKanbanStore = create<KanbanState>((set, get) => {
    const api_request = useRequestStore.getState().api_request;
    let isFetchingTickets = false;
    let lastTicketsFetchAt = 0;
    let lastTicketsFetchKey = '';
    let isFetchingPaymentsTree = false;
    let lastPaymentsTreeFetchAt = 0;

    const fetchTickets = async (statuses?: string[]): Promise<void> => {
        const key = JSON.stringify(statuses ?? []);
        const now = Date.now();
        const recentlyFetched = key === lastTicketsFetchKey && now - lastTicketsFetchAt < 5000;

        if (isFetchingTickets && key === lastTicketsFetchKey) return;
        if (recentlyFetched) return;

        isFetchingTickets = true;
        lastTicketsFetchKey = key;
        lastTicketsFetchAt = now;

        try {
            const response = await api_request<Ticket[]>('tickets', { satuses: statuses });
            const handleData = response.map((item) => ({ ...item }));
            set({ tickets: handleData, tickets_updated_at: Date.now() });
        } catch (e) {
            console.error('Error fetching tickets:', e);
        } finally {
            isFetchingTickets = false;
        }
    };

    const fetchTicketById = async (ticket_id: string): Promise<Ticket | null> => {
        try {
            const response = await api_request<{ ticket: Ticket }>('tickets/get-by-id', { ticket_id });
            return response.ticket;
        } catch (e) {
            console.error('Error fetching ticket:', e);
            return null;
        }
    };

    const fetchDictionary = async (): Promise<void> => {
        const show_inactive = useCRMStore.getState().isInActiveVisible;
        const data = await api_request<DictionaryResponse>('dictionary', { show_inactive });
        set({
            projects: data.projects.map((p) => p.name),
            performers: data.performers,
            projectsData: data.projects,
            customers: data.customers,
            projectGroups: data.projectGroups,
            tree: data.tree,
            task_types: data.task_types,
            task_supertypes: data.task_supertypes,
            task_types_tree: data.task_types_tree,
            epics: data.epics?.reduce((acc, e) => ({ ...acc, [e._id]: e }), {}) ?? null,
            income_types: data.income_types,
        });
    };

    const getProjectByIdentifier = (project?: string): Project | undefined => {
        if (!project) return undefined;
        const target = project.toString();
        const { projectsData } = get();
        return (
            projectsData.find((item) => item._id.toString() === target) ??
            projectsData.find((item) => item.name === target)
        );
    };

    return {
        statusesFilter: ['READY_TO_GO', 'IN_PROGRESS'],
        setStatusesFilter: (statuses) => set({ statusesFilter: statuses }),

        getCustomerByProject: (project) => {
            if (!project) {
                return '';
            }
            const projectDoc = getProjectByIdentifier(project);
            if (!projectDoc?._id) {
                return '';
            }
            const projectGroup = get().projectGroups.find((group: ProjectGroup) => {
                if (group._id && projectDoc.project_group && group._id.toString() === projectDoc.project_group.toString()) {
                    return true;
                }
                return (group.projects_ids ?? []).some((id: string) => id.toString() === projectDoc._id);
            });
            if (!projectGroup?._id) {
                return '';
            }
            const customer = get().customers.find((item: Customer) =>
                (item.project_groups_ids ?? []).some((id: string) => id.toString() === projectGroup._id)
            );
            return customer?.name ?? '';
        },

        getProjectGroupByProject: (project) => {
            if (!project) {
                return '';
            }
            const projectDoc = getProjectByIdentifier(project);
            if (!projectDoc?._id) {
                return '';
            }
            const projectGroup = get().projectGroups.find((group: ProjectGroup) => {
                if (group._id && projectDoc.project_group && group._id.toString() === projectDoc.project_group.toString()) {
                    return true;
                }
                return (group.projects_ids ?? []).some((id: string) => id.toString() === projectDoc._id);
            });
            return projectGroup?.name ?? '';
        },

        tickets: [],
        tickets_updated_at: null,
        boards: [],
        customers: [],
        projectGroups: [],
        income_types: [],
        task_types: [],
        task_supertypes: [],
        task_types_tree: [],
        tree: [],
        saveTree: (tree) => set({ tree }),

        moveNode: (node, destination) => {
            switch (node.type) {
                case 'project': {
                    if (destination.type !== 'group') {
                        return;
                    }
                    const projectId = node.key ?? node._id ?? '';
                    const sourceProjectGroup = get().projectGroups.find((group) =>
                        (group.projects_ids ?? []).some((id) => id.toString() === projectId)
                    );
                    api_request('projects/move', {
                        project: node,
                        source_project_group: sourceProjectGroup ?? null,
                        dest_project_group: destination,
                    });
                    break;
                }
                case 'group': {
                    if (destination.type !== 'customer') {
                        return;
                    }
                    const groupId = node.key ?? node._id ?? '';
                    const sourceCustomer = get().customers.find((customer) =>
                        (customer.project_groups_ids ?? []).some((id) => id.toString() === groupId)
                    );
                    api_request('project_groups/move', {
                        project_group: node,
                        source_customer: sourceCustomer ?? null,
                        dest_customer: destination,
                    });
                    break;
                }
            }
        },

        saveProject: async (project, projectGroup) => {
            if (project._id) {
                await api_request('projects/update', { project });
            } else {
                await api_request('projects/create', { project, project_group: projectGroup });
                await get().fetchDictionary();
            }
        },

        saveCustomer: async (customer) => {
            if (customer._id) {
                await api_request('customers/update', { customer });
            } else {
                await api_request('customers/create', { customer });
                await get().fetchDictionary();
            }
        },

        saveProjectGroup: async (projectGroup, customer) => {
            if (projectGroup._id) {
                await api_request('project_groups/update', { project_group: projectGroup, customer });
            } else {
                await api_request('project_groups/create', { project_group: projectGroup, customer });
                await get().fetchDictionary();
            }
        },

        performers: [],
        setPayment: (performer, payments) => {
            const record_index = _.findIndex(get().performers, (t) => t._id === performer._id);
            set((state) => ({
                performers: update(state.performers, {
                    [record_index]: { payments: { $set: payments }, _payments_changed: { $set: true } },
                }),
            }));
        },

        projects: [],
        projectsData: [],
        epics: null,

        fetchTickets,
        fetchTicketById,
        fetchDictionary,

        updateTicket: async (ticket, updateProps, opt) => {
            const updateObj = _.reduce(
                Object.entries(updateProps),
                (result, [prop, value]) => {
                    result[prop] = { $set: value };
                    return result;
                },
                {} as Record<string, { $set: unknown }>
            );

            const doneStatuses: string[] = [
                TASK_STATUSES.DONE_10,
                TASK_STATUSES.DONE_20,
                TASK_STATUSES.DONE_30,
                TASK_STATUSES.ARCHIVE,
            ];
            if (updateProps.task_status && doneStatuses.includes(updateProps.task_status)) {
                updateObj.notifications = { $set: null };
            }

            const record_index = _.findIndex(get().tickets, (t) => t._id === ticket._id);
            set((state) => ({ tickets: update(state.tickets, { [record_index]: updateObj }) }));

            await api_request('tickets/update', { ticket: ticket._id, updateProps }, opt);
        },

        editTicketData: async (ticket) => {
            const performer = _.find(get().performers, { _id: ticket.performer as string });
            if (performer) {
                ticket.performer = performer;
            }
            const updateProps = _.omit(ticket, ['_id', 'id']);
            if (typeof updateProps.project === 'string') {
                const normalizedProject = getProjectByIdentifier(updateProps.project);
                if (normalizedProject) {
                    updateProps.project = normalizedProject.name;
                    updateProps.project_id = normalizedProject._id;
                    updateProps.project_data = {
                        _id: normalizedProject._id,
                        name: normalizedProject.name,
                    };
                } else if (typeof updateProps.project === 'string' && /^[0-9a-fA-F]{24}$/.test(updateProps.project)) {
                    updateProps.project_id = updateProps.project;
                }
            }

            const updateObj = _.reduce(
                Object.entries(updateProps),
                (result, [prop, value]) => {
                    result[prop] = { $set: value };
                    return result;
                },
                {} as Record<string, { $set: unknown }>
            );
            const record_index = _.findIndex(get().tickets, (t) => t._id === ticket._id);
            set((state) => ({ tickets: update(state.tickets, { [record_index]: updateObj }) }));

            await api_request('tickets/update', { ticket: ticket._id, updateProps }, { silent: true });
        },

        deleteTicket: async (ticket_id) => {
            await api_request('tickets/delete', { ticket: ticket_id });
            const record_index = _.findIndex(get().tickets, (t) => t._id === ticket_id);
            set((state) => ({ tickets: update(state.tickets, { $splice: [[record_index, 1]] }) }));
        },

        createTicket: async (values) => {
            if (values.description) {
                values.description = sanitizeHtml(values.description, {
                    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
                });
            }

            const response = await api_request<{ ticket_db: Ticket }>('tickets/create', { data: values });
            const new_ticket = response.ticket_db;
            const normalizedProject = getProjectByIdentifier(
                typeof new_ticket.project_id === 'string'
                    ? new_ticket.project_id
                    : new_ticket.project_id
                      ? `${new_ticket.project_id}`
                      : undefined
            );
            if (normalizedProject) {
                new_ticket.project = normalizedProject.name;
            }

            const performer = _.find(get().performers, { _id: values.performer as string });
            if (performer) {
                new_ticket.performer = performer;
            }

            set((state) => ({ tickets: update(state.tickets, { $push: [new_ticket] }) }));
        },

        saveComment: async (ticket, comment_text) => {
            const comment = {
                comment: comment_text,
                created_at: Date.now(),
                author: null,
            };
            const record_index = _.findIndex(get().tickets, (t) => t.id === ticket.id);
            const currentTicket = get().tickets[record_index];
            if (!currentTicket) return;

            if (!currentTicket.comments_list) {
                set((state) => ({
                    tickets: update(state.tickets, { [record_index]: { comments_list: { $set: [comment] } } }),
                }));
            } else {
                set((state) => ({
                    tickets: update(state.tickets, { [record_index]: { comments_list: { $push: [comment] } } }),
                }));
            }
            await api_request('tickets/add-comment', { ticket: ticket._id, comment_text }, { silent: true });
        },

        uploadFile: async (file) => {
            const relative_url = await useRequestStore.getState().sendFile(file, { silent: true });
            const backendUrl =
                import.meta.env.VITE_CRM_API_URL ||
                import.meta.env.VITE_API_URL ||
                import.meta.env.VITE_API_BASE_URL ||
                '/api/crm';
            return backendUrl + relative_url;
        },

        massiveChangeStatus: async (tickets, new_status) => {
            for (const ticket_id of tickets) {
                const record_index = _.findIndex(get().tickets, (t) => t._id === ticket_id);
                set((state) => ({
                    tickets: update(state.tickets, { [record_index]: { task_status: { $set: new_status } } }),
                }));
            }
            await api_request('tickets/bulk-change-status', { tickets, new_status });
        },

        addWorkHours: async (data) => {
            const formattedData = {
                ...data,
                date: data.date.format('YYYY-MM-DD'),
            };
            const response = await api_request<{ result: WorkData }>('tickets/add-work-hours', formattedData);
            const result = response.result;
            const record_index = _.findIndex(get().tickets, (t) => t._id === data.ticket_id);
            const current_hours = get().tickets[record_index]?.total_hours
                ? parseFloat(String(get().tickets[record_index]?.total_hours))
                : 0.0;
            const new_total = current_hours + parseFloat(String(data.time));
            set((state) => ({
                tickets: update(state.tickets, {
                    [record_index]: {
                        work_data: { $push: [result] },
                        total_hours: { $set: new_total },
                    },
                }),
            }));
        },

        editWorkHour: async (data) => {
            const formattedData = {
                ...data,
                date: data.date.format('YYYY-MM-DD'),
            };
            const response = await api_request<{ result: WorkData }>('tickets/edit-work-hour', formattedData);
            const result = response.result;
            const record_index = _.findIndex(get().tickets, (t) => t._id === data.ticket_id);
            const ticket = get().tickets[record_index];
            if (!ticket?.work_data) return;

            const work_data_index = _.findIndex(ticket.work_data, (w) => w._id === data._id);
            const old_work_hours = ticket.work_data[work_data_index]?.work_hours ?? 0;
            const current_hours = ticket.total_hours ? parseFloat(String(ticket.total_hours)) : 0.0;
            const new_total = current_hours + parseFloat(String(data.time)) - old_work_hours;
            set((state) => ({
                tickets: update(state.tickets, {
                    [record_index]: {
                        work_data: { [work_data_index]: { $set: result } },
                        total_hours: { $set: new_total },
                    },
                }),
            }));
        },

        getDesignSections: async (figma_file_url) => {
            const pages_data = await api_request('figma/get-sections', { figma_file_url });
            set({ fileDesignSections: pages_data as unknown[] });
        },
        fileDesignSections: [],
        projectFilesList: [],
        getProjectFiles: async (selectedNode) => {
            const project = _.find(get().projectsData, (p) => p._id === selectedNode.key);
            if (!project) return;
            const files_data = await api_request('figma/get-project-files', { project_id: project._id });
            set({ projectFilesList: files_data as unknown[] });
        },
        clearProjectFiles: () => set({ projectFilesList: [] }),

        startSync: async (pair, sectionsToSync) => {
            const file_sync_data = {
                source_file_id: (pair as { des: { fileKey: string } }).des.fileKey,
                destination_file_id: (pair as { dev: { fileKey: string } }).dev.fileKey,
                source_file_url: (pair as { des: { fileUrl: string } }).des.fileUrl,
                destination_file_url: (pair as { dev: { fileUrl: string } }).dev.fileUrl,
                sync_data: sectionsToSync,
            };

            await api_request('figma/set-sync-sections', { file_sync_data });
            window.open(file_sync_data.source_file_url);
        },

        getProjectByName: (project_name) => {
            return getProjectByIdentifier(project_name);
        },

        getProjectEpics: (project_name) => {
            const project = getProjectByIdentifier(project_name);
            if (!project) return [];
            return project.epics ?? [];
        },

        createEpic: async (values) => {
            const new_epic = { ...values };
            if (new_epic.description) {
                new_epic.description = sanitizeHtml(new_epic.description);
            }
            const response = await api_request<{ db_epic: Epic }>('epics/create', { epic: new_epic });
            const updated_epics = { ...get().epics, [response.db_epic._id]: response.db_epic };
            set({ epics: updated_epics });

            const project_index = _.findIndex(get().projectsData, (p) => p._id === new_epic.project);
            if (project_index === -1) return;

            const existingProject = get().projectsData[project_index];
            if (!existingProject) return;

            const updated_projects_data = [...get().projectsData];
            updated_projects_data[project_index] = {
                ...existingProject,
                epics: [...(existingProject.epics ?? []), response.db_epic],
            };
            set({ projectsData: updated_projects_data });
        },

        editEpic: async (epic) => {
            const updateProps = _.omit(epic, ['_id', 'project_name']);
            const updateObj = _.reduce(
                Object.entries(updateProps),
                (result, [prop, value]) => {
                    result[prop] = { $set: value };
                    return result;
                },
                {} as Record<string, { $set: unknown }>
            );

            set((state) => ({
                epics: state.epics ? update(state.epics, { [epic._id]: updateObj }) : state.epics,
            }));

            await api_request('epics/update', { epic: epic._id, updateProps }, { silent: true });
        },

        deleteEpic: async (epic) => {
            await api_request('epics/delete', { epic: epic._id }, { silent: true });
            get().fetchDictionary();
            get().fetchTickets([
                'NEW_0',
                'NEW_10',
                'NEW_20',
                'NEW_30',
                'NEW_40',
                'PLANNED_10',
                'PLANNED_20',
                'READY_10',
                'PROGRESS_10',
                'PROGRESS_20',
                'PROGRESS_30',
                'PROGRESS_40',
                'REVIEW_10',
                'REVIEW_20',
                'AGREEMENT_10',
                'AGREEMENT_20',
                'DONE_10',
            ]);
        },

        fetchExpensesData: async () => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;
            const performers = get().performers;
            const expenses_raw = await api_request<ExpenseRecord[]>('finances/expenses', { month, year });

            const updatedPerformers = performers.map((p) => {
                const expenses = _.find(expenses_raw, (t) => t.performer_id === p._id);
                return expenses ? { ...p, payments: expenses.payments } : p;
            });
            set({ performers: updatedPerformers });
        },

        savePayments: async () => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;

            const to_save = get()
                .performers.filter((p) => p._payments_changed === true)
                .map((p) => ({
                    performer_id: p._id,
                    payments: p.payments,
                    year,
                    month,
                }));
            await api_request('finances/set-payments', { to_save });
        },

        incomeData: null,
        fetchIncomeData: async () => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;
            const performers = get().performers;

            const income_rows = await api_request<IncomeRecord[]>('finances/income', { month, year });
            for (const row of income_rows) {
                const performer = _.find(performers, (p) => p._id === row.performer);
                row.performer_name = performer?.real_name;
            }

            set({ incomeData: income_rows });
        },

        saveIncomeRow: async (value) => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;
            const to_save = { ...value, month, year };
            const op_result = await api_request<{ insertedId?: string }>('finances/save-income', { to_save });
            if (!value._id && op_result.insertedId) {
                const performer = _.find(get().performers, (p) => p._id === value.performer);
                const newValue: IncomeRecord = { ...value, _id: op_result.insertedId, performer_name: performer?.real_name };
                set((state) => ({
                    incomeData: state.incomeData ? update(state.incomeData, { $push: [newValue] }) : [newValue],
                }));
            }
        },

        deleteIncomeRow: async () => {
            // TODO: implement
        },

        performersMarginData: [],
        fetchPeformersMarginData: async () => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;
            const margin_data = await api_request('finances/margin-performers', { month, year });
            set({ performersMarginData: margin_data as unknown[] });
        },

        projectsMarginData: [],
        fetchProjectsMarginData: async () => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;
            const margin_data = await api_request('finances/margin-projects', { month, year });
            set({ projectsMarginData: margin_data as unknown[] });
        },

        monthWorkHours: null,
        setMonthWorkHours: (value) => set({ monthWorkHours: value }),

        saveMonthWorkHours: async () => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;
            const month_work_hours = get().monthWorkHours;
            await api_request('finances/save-month-work-hours', { month, year, month_work_hours });
        },

        fetchMonthWorkHours: async () => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;
            const month_work_hours = await api_request<number>('finances/month-work-hours', { month, year });
            set({ monthWorkHours: month_work_hours });
        },

        widgetsActualProjects: [],
        widgetsData: null,

        fetchMetricsWidgets: async () => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;

            const raw_data = await api_request<{
                expenses: ExpenseRecord[];
                income: IncomeRecord[];
                works: WorkData[];
                month_work_hours: number;
            }>('finances/widgets', { month, year });

            const { expenses, income, works, month_work_hours } = raw_data;
            const projects = get().projects;
            const performers = get().performers;

            const income_by_project = _.reduce(
                income,
                (result, obj) => {
                    const projectKey = obj.project;
                    if (!result[projectKey]) result[projectKey] = [];
                    result[projectKey].push(obj);
                    return result;
                },
                {} as Record<string, IncomeRecord[]>
            );

            const expenses_by_perf = _.reduce(
                expenses,
                (result, obj) => {
                    result[obj.performer_id] = obj;
                    return result;
                },
                {} as Record<string, ExpenseRecord>
            );

            const performers_by_id = _.reduce(
                performers,
                (result, obj) => {
                    if (obj.id) result[obj.id] = obj;
                    return result;
                },
                {} as Record<string, Performer>
            );

            const performers_by__id = _.reduce(
                performers,
                (result, obj) => {
                    result[obj._id] = obj;
                    return result;
                },
                {} as Record<string, Performer>
            );

            const projects_data: Array<{ project: string; income: number; expenses: number }> = [];
            for (const project of projects) {
                const project_incomes_data = income_by_project[project] ?? [];
                const project_income = _.reduce(
                    project_incomes_data,
                    (total, inc) => total + parseFloat(String(inc.hours_amount)) * parseFloat(String(inc.hour_price)),
                    0.0
                );
                const project_hours = works.filter((w) => w.project === project);

                let projectExpenses = 0.0;
                for (const ph of project_hours) {
                    const createdBy = ph.created_by;
                    if (!createdBy) continue;
                    const performer = performers_by_id[createdBy];
                    if (!performer) continue;
                    const performerExpense = expenses_by_perf[performer._id];
                    const perf_monthly_payment = performerExpense
                        ? parseFloat(String(performerExpense.payments))
                        : 0.0;
                    const payment_by_hour = perf_monthly_payment / parseFloat(String(month_work_hours));
                    projectExpenses += parseFloat(String(ph.work_hours)) * payment_by_hour;
                }
                projects_data.push({
                    project,
                    income: project_income,
                    expenses: projectExpenses,
                });
            }

            const filtered_projects = projects_data.filter((d) => d.income !== 0 || d.expenses !== 0);
            const actual_projects = filtered_projects.map((p) => ({
                name: p.project,
                full_name: `${p.project} (${get().getCustomerByProject(p.project)})`,
            }));

            set({
                widgetsProjectsFilter: actual_projects.map((p) => p.name),
                widgetsPerformersFilter: performers.map((p) => p._id),
                widgetsActualProjects: actual_projects,
                widgetsData: {
                    expenses,
                    income,
                    works,
                    performers_by__id,
                },
            });
        },

        widgetsProjectsFilter: [],
        setWidgetsProjectsFilter: (d) => set({ widgetsProjectsFilter: d }),

        widgetsPerformersFilter: [],
        setWidgetsPerformersFilter: (d) => set({ widgetsPerformersFilter: d }),

        calculadetWidgetsData: null,
        calculateWidgets: () => {
            const data = get().widgetsData;
            if (!data?.expenses) return;

            const filterProjects = get().widgetsProjectsFilter;
            const filterPerformers = get().widgetsPerformersFilter;

            const f_expenses = data.expenses.filter((ex) => filterPerformers.includes(ex.performer_id));
            const f_income = data.income.filter(
                (i) => filterPerformers.includes(i.performer) && filterProjects.includes(i.project)
            );
            const f_works = data.works.filter(
                (w) => w.performer && w.project && filterPerformers.includes(w.performer) && filterProjects.includes(w.project)
            );

            const s_expenses = _.reduce(f_expenses, (total, ex) => total + parseFloat(String(ex.payments)), 0.0);
            const s_income = _.reduce(
                f_income,
                (total, inc) => total + parseFloat(String(inc.hours_amount ?? 0)) * parseFloat(String(inc.hour_price ?? 0)),
                0.0
            );
            const s_margin = s_income - s_expenses;

            const by_performers: Record<string, { p_income: number; p_expenses: number; p_margin: number }> = {};
            for (const perf_id of filterPerformers) {
                const perf = data.performers_by__id[perf_id];
                if (!perf) continue;
                const p_income = _.reduce(
                    f_income.filter((i) => i.performer === perf_id),
                    (total, inc) => total + parseFloat(String(inc.hours_amount ?? 0)) * parseFloat(String(inc.hour_price ?? 0)),
                    0.0
                );
                const found_ex_perf = _.find(f_expenses, (ex) => ex.performer_id === perf_id);
                const p_expenses = found_ex_perf ? parseFloat(String(found_ex_perf.payments)) : 0.0;
                const p_margin = p_income - p_expenses;
                by_performers[perf.real_name ?? perf.name] = { p_income, p_expenses, p_margin };
            }

            const real_s_work_hours = _.reduce(f_works, (total, w) => total + parseFloat(String(w.work_hours ?? 0)), 0.0);
            const total_s_work_hours = filterPerformers.length * (get().monthWorkHours ?? 0);
            const selled_s_work_hours = _.reduce(
                f_income,
                (total, inc) => total + parseFloat(String(inc.hours_amount ?? 0)),
                0.0
            );

            set({
                calculadetWidgetsData: {
                    s_expenses,
                    s_income,
                    s_margin,
                    real_s_work_hours,
                    total_s_work_hours,
                    selled_s_work_hours,
                    by_performers,
                },
            });
        },

        botCommands: null,
        fetchBotCommands: async () => {
            const commands_data = await api_request<BotCommand[]>('bot-commands');
            set({ botCommands: commands_data });
        },

        saveBotCommand: async (command) => {
            const response = await api_request<{ _id: string }>('bot-commands/save', { command });
            const found_command = _.find(get().botCommands, (c) => c._id === command._id);
            if (found_command) {
                const record_index = _.findIndex(get().botCommands, (t) => t._id === command._id);
                set((state) => ({
                    botCommands: state.botCommands ? update(state.botCommands, { [record_index]: { $set: command } }) : null,
                }));
            } else {
                command._id = response._id;
                set((state) => ({
                    botCommands: state.botCommands ? update(state.botCommands, { $push: [command] }) : [command],
                }));
            }
        },

        deleteBotCommand: async (command_id) => {
            await api_request('bot-commands/delete', { command_id });
            const record_index = _.findIndex(get().botCommands, (t) => t._id === command_id);
            set((state) => ({
                botCommands: state.botCommands ? update(state.botCommands, { $splice: [[record_index, 1]] }) : null,
            }));
        },

        testResult: [],
        testBotCommand: async (command, text) => {
            const commandCopy = { ...command, stages: [...command.stages] };
            if (commandCopy.stages.length > 0) {
                const lastStage = commandCopy.stages[commandCopy.stages.length - 1];
                if (lastStage) {
                    lastStage.generate_document = true;
                }
            }
            const result = await api_request('bot-commands/test', { command: commandCopy, text });
            set({ testResult: result as unknown[] });
        },

        roadmap: null,
        fetchRoadmap: async (project_id) => {
            const roadmap = await api_request<{ epics: Epic[] }>('roadmaps', { project_id });
            set({ roadmap: roadmap.epics });
        },

        taskTypesTree: null,
        fetchTaskTypes: async () => {
            const task_types = await api_request<TaskType[]>('task-types');
            set({ taskTypesTree: task_types });
        },

        saveTaskType: async (task_type) => {
            const response = await api_request<{ _id: string }>('task-types/save', { task_type });
            const found_task_type = _.find(get().taskTypesTree, (c) => c._id === task_type._id);
            if (found_task_type) {
                const updateObj = _.reduce(
                    Object.entries(task_type),
                    (result, [prop, value]) => {
                        result[prop] = { $set: value };
                        return result;
                    },
                    {} as Record<string, { $set: unknown }>
                );
                const record_index = _.findIndex(get().taskTypesTree, (t) => t._id === task_type._id);
                set((state) => ({
                    taskTypesTree: state.taskTypesTree ? update(state.taskTypesTree, { [record_index]: updateObj }) : null,
                }));
            } else {
                task_type._id = response._id;
                set((state) => ({
                    taskTypesTree: state.taskTypesTree ? update(state.taskTypesTree, { $push: [task_type] }) : [task_type],
                }));
            }
        },

        saveFunctionality: async (functionality) => {
            const response = await api_request<{ _id: string }>('task-types/save-functionality', { functionality });
            const found_functionality = _.find(get().taskTypesTree, (c) => c._id === functionality._id);
            if (found_functionality) {
                const updateObj = _.reduce(
                    Object.entries(functionality),
                    (result, [prop, value]) => {
                        result[prop] = { $set: value };
                        return result;
                    },
                    {} as Record<string, { $set: unknown }>
                );
                const record_index = _.findIndex(get().taskTypesTree, (t) => t._id === functionality._id);
                set((state) => ({
                    taskTypesTree: state.taskTypesTree ? update(state.taskTypesTree, { [record_index]: updateObj }) : null,
                }));
            } else {
                const newFunc = {
                    ...functionality,
                    _id: response._id,
                    key: response._id,
                };
                set((state) => ({
                    taskTypesTree: state.taskTypesTree ? update(state.taskTypesTree, { $push: [newFunc] }) : [newFunc],
                }));
                return newFunc as TaskType;
            }
            return functionality;
        },

        performerFinancesData: null,
        fetchPerfrormerFinances: async (performer_id) => {
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;
            const response = await api_request('performers-payments/finances', { performer_id, month, year });
            set({ performerFinancesData: response });
        },

        performersPaymentsTree: null,
        fetchPerformersPaymentsTree: async () => {
            const now = Date.now();
            if (isFetchingPaymentsTree) return;
            if (now - lastPaymentsTreeFetchAt < 60000) return;

            isFetchingPaymentsTree = true;
            lastPaymentsTreeFetchAt = now;
            try {
                const response = await api_request<{ payments_tree: unknown }>('performers-payments/payments-tree');

                const transformPaymentsTreeToTreeData = (payments_tree: Record<string, unknown>): PaymentTreeNode[] => {
                    const tree: PaymentTreeNode[] = [];
                    let performerIndex = 0;

                    for (const performerId in payments_tree) {
                        const performerData = payments_tree[performerId] as {
                            performer: Performer;
                            templates?: Array<{ name: string; webViewLink: string }>;
                            payments?: Record<string, Record<string, unknown[]>>;
                        };
                        const performer = performerData.performer;
                        const templates = performerData.templates ?? [];
                        const payments = performerData.payments ?? {};

                        const performerNode: PaymentTreeNode = {
                            type: 'performer',
                            title: performer.real_name ?? performer.name,
                            performer_id: performer.id,
                            key: `0-${performerIndex}`,
                            children: [],
                        };

                        // Templates
                        performerNode.children?.push({
                            type: 'folder',
                            title: 'Шаблоны',
                            key: `0-${performerIndex}-0`,
                            children: templates.map((tpl, tplIdx) => ({
                                type: 'document',
                                title: tpl.name,
                                document_url: tpl.webViewLink,
                                edit_url: tpl.webViewLink,
                                key: `0-${performerIndex}-0-${tplIdx}`,
                            })),
                        });

                        // Payments
                        const paymentsFolder: PaymentTreeNode = {
                            type: 'folder',
                            title: 'Выплаты',
                            key: `0-${performerIndex}-1`,
                            children: [],
                        };

                        let yearIdx = 0;
                        for (const year in payments) {
                            const yearNode: PaymentTreeNode = {
                                type: 'year',
                                title: year,
                                key: `0-${performerIndex}-1-${yearIdx}`,
                                performer_id: performer.id,
                                children: [],
                                parent_title: performerNode.title,
                            };

                            let paymentFolderIdx = 0;
                            for (const paymentFolder in payments[year]) {
                                const paymentFolderData = payments[year][paymentFolder] as Array<{
                                    title?: string;
                                    name?: string;
                                    document_url?: string;
                                    webViewLink?: string;
                                    edit_url?: string;
                                }>;
                                const paymentFolderNode: PaymentTreeNode = {
                                    type: 'folder',
                                    title: paymentFolder,
                                    key: `0-${performerIndex}-1-${yearIdx}-${paymentFolderIdx}`,
                                    children: [],
                                    parent_title: yearNode.title,
                                };

                                if (Array.isArray(paymentFolderData)) {
                                    paymentFolderData.forEach((doc, docIdx) => {
                                        paymentFolderNode.children?.push({
                                            type: 'document',
                                            title: doc.title ?? doc.name ?? `Документ ${docIdx + 1}`,
                                            document_url: doc.document_url ?? doc.webViewLink,
                                            edit_url: doc.edit_url ?? doc.webViewLink,
                                            key: `0-${performerIndex}-1-${yearIdx}-${paymentFolderIdx}-${docIdx}`,
                                            parent_title: paymentFolderNode.title,
                                        });
                                    });
                                }
                                yearNode.children?.push(paymentFolderNode);
                                paymentFolderIdx++;
                            }
                            paymentsFolder.children?.push(yearNode);
                            yearIdx++;
                        }
                        performerNode.children?.push(paymentsFolder);
                        tree.push(performerNode);
                        performerIndex++;
                    }
                    return tree;
                };

                const paymentsTreeData = transformPaymentsTreeToTreeData(response.payments_tree as Record<string, unknown>);
                set({ performersPaymentsTree: paymentsTreeData });
            } finally {
                isFetchingPaymentsTree = false;
            }
        },

        calculateBonus: (stats, paymentData) => {
            const paymentType = paymentData.payment_type;
            const payment =
                paymentType === 'hourly'
                    ? (paymentData.hourly_rate ?? 0) * stats.totalWorkHours
                    : paymentData.monthly_rate ?? 0;

            const basicBonus = payment * 0.15;

            const k_hours = 1 - 0.5 * (stats.daysBelowANormal / stats.totalDaysWithWork);
            const k_review = stats.averageReviewsCount <= 1.25 ? 1 : 1 - (stats.averageReviewsCount - 1.25);
            const k_speed = stats.ticketWithReviewCount
                ? 1 - 0.3 * (stats.ticketsAboveNormalTimeBetweenReadyAndReview / stats.ticketWithReviewCount)
                : 1;

            let bonus = basicBonus * k_hours * k_review * k_speed;

            if (paymentData.custom_bonus) {
                bonus += paymentData.custom_bonus;
            }

            const total = payment + bonus;
            const taxCompensation = paymentData.tax ? Math.round((total * paymentData.tax) / 100) : null;
            const taxed = paymentData.tax ? Math.round(total + (total * paymentData.tax) / 100) : null;

            return {
                k_hours,
                k_review,
                k_speed,
                payment,
                basicBonus,
                customBonus: paymentData.custom_bonus,
                bonus,
                total,
                taxed,
                taxCompensation,
            };
        },

        createPayment: async (performer_id, works, stats, paymentData) => {
            const bonusData = get().calculateBonus(stats, paymentData);
            const total = paymentData.tax ? Math.round(bonusData.taxed ?? 0) : Math.round(bonusData.total);
            const month = useCRMStore.getState().metricsMonth;
            const year = useCRMStore.getState().metricsYear;

            const works_data: Record<string, string[]> = {};
            for (const [project, tickets] of Object.entries(works as Record<string, Array<{ ticket: { name: string } }>>)) {
                works_data[project] = tickets.map((ticket) => ticket.ticket.name);
            }

            const response = await api_request('performers-payments/create-payment', {
                performer_id,
                works: works_data,
                total,
                paymentData,
                month,
                year,
            });
            return response;
        },

        performersData: [],
        fetchPerformersData: async () => {
            const performers_data = await api_request('performers-payments/payments-settings');
            set({ performersData: performers_data as unknown[] });
        },

        savePaymentsSettings: async (settings, performer_id) => {
            await api_request('performers-payments/save-payments-settings', { payments_settings: settings, performer_id });
        },

        warehouseTree: null,
        fetchWarehouseTree: async () => {
            const response = await api_request<{ tree: unknown }>('warehouse/tree');
            set({ warehouseTree: response.tree });
        },

        importFromGoogleSheets: async (spreadsheet_url) => {
            const response = await api_request('import/google_sheet', { spreadsheet_url });
            return response;
        },
    };
});
