/**
 * CRM Store - UI state for CRM tables
 * Migrated from appkanban/src/store/crm.js
 */

import { create } from 'zustand';
import Cookies from 'universal-cookie';
import dayjs from 'dayjs';
import _ from 'lodash';
import update from 'immutability-helper';

import { useRequestStore } from './requestStore';
import { TASK_STATUSES } from '../constants/crm';
import type {
    Ticket,
    Epic,
    TreeNode,
    FigmaSyncPair,
    SectionToSync,
    WeekReports,
    BotCommand,
    EditingColumn,
    CRMFilters,
} from '../types/crm';

const cookies = new Cookies();

interface SelectedSections {
    [key: string]: number;
}

interface SelectedSectionPairs {
    [key: string]: unknown;
}

interface CRMState {
    // Week reports
    week_reports: WeekReports;
    fetchReports: () => Promise<void>;

    // Editing states
    editingColumn: EditingColumn;
    setEditingColumn: (ticket: Ticket | null, column: string | null) => void;

    editingTicket: Ticket | null;
    setEditingTicket: (ticket: Ticket | null) => void;
    setEditingTicketToNew: () => void;

    editingEpic: Epic | null;
    setEditingEpic: (epic: Epic | null) => void;
    setEditingEpicToNew: () => void;

    // Tree navigation
    selectedNode: TreeNode | null;
    setSelectedNode: (data: TreeNode | null) => void;

    editingNode: TreeNode | null;
    setEditingNode: (node: TreeNode | null) => void;

    // Forms
    newEntityForm: string | null;
    setNewEntityForm: (formName: string | null) => void;

    editForm: string | null;
    setEditForm: (formName: string | null) => void;

    // Filters
    isInActiveVisible: boolean;
    setIsInActiveVisible: (is_visible: boolean) => void;

    statusFilter: string[];
    setStatusFilter: (filter: string[]) => void;

    savedFilters: CRMFilters;
    saveFilters: (filters: CRMFilters) => void;

    savedTab: string;
    saveTab: (tab: string | number) => void;

    all_statuses_stat: Record<string, number>;
    calculateStatusesStat: (tickets?: Ticket[]) => void;

    // Comments and work hours
    commentedTicket: Ticket | null;
    setCommentedTicket: (ticket: Ticket | null) => void;

    editingWorkHours: Ticket | null;
    setEditingWorkHours: (ticket: Ticket | null) => void;

    // Figma sync
    pairToSync: FigmaSyncPair | null;
    setPairToSync: (pair: FigmaSyncPair) => Promise<void>;
    clearPairToSync: () => void;

    secitionsToSync: Record<string, SectionToSync>;
    addSectionToSync: (pair: FigmaSyncPair, page: { name: string; node_id: string }, section: { name: string; node_id: string }) => void;
    removeSectionFromSync: (pair: FigmaSyncPair, page: { name: string; node_id: string }, section: { name: string; node_id: string }) => void;
    clearSectionsToSync: () => void;

    // Section selection for sync
    currentMark: number;
    selectedSectionPairs: SelectedSectionPairs;
    selectedSections: SelectedSections;
    selectedSectionMode: 'none' | 'select_dev' | 'select_des';
    toggleSectionToSync: (pair: FigmaSyncPair, page: { name: string; node_id: string }, section: { name: string; node_id: string }, isDev: boolean) => void;
    getSectionsToSync: () => Array<{ from: unknown; to: unknown }>;

    // Project editing
    editTiketProject: string | null;
    setEditTiketProject: (p: string | null) => void;

    // Metrics
    metricsMonth: number;
    setMetricMonth: (m: number) => void;

    metricsYear: number;
    setMetricYear: (y: number) => void;

    // Income editing
    editedIncomeRow: unknown | null;
    setEditedIncomeRow: (d: unknown | null) => void;

    // Work hours
    isMonthWorkHoursChanged: boolean;
    setIsMonthWorkHoursChanged: (d: boolean) => void;

    // Approve modal
    approveModalOpen: unknown | null;
    setApproveModalOpen: (d: unknown | null) => void;

    // Bot commands
    emptyBotCommand: BotCommand;
    selectedBotCommand: BotCommand;
    setSelectedBotCommand: (d: BotCommand) => void;

    testText: string;
    setTestText: (d: string) => void;

    commandSearchText: string;
    setCommandSearchText: (d: string) => void;

    // Additional filters
    clientFilter: string | null;
    setClientFilter: (d: string | null) => void;

    projectFilter: string[];
    setProjectFilter: (d: string[]) => void;

    selectedProject: string | null;
    setSelectedProject: (d: string | null) => void;
}

export const useCRMStore = create<CRMState>((set, get) => {
    // Load saved values from cookies
    let savedTab = cookies.get('crm-tab') ?? '1';
    savedTab = savedTab.toString();

    let savedFilters = cookies.get('crm-filters') ?? {};

    const api_request = useRequestStore.getState().api_request;

    const fetchReports = async (): Promise<void> => {
        try {
            const response = await api_request<WeekReports>('reports', {});
            set({ week_reports: response });
        } catch (e) {
            console.error('Error fetching reports:', e);
        }
    };

    const emptyBotCommand: BotCommand = {
        short_name: '',
        name: '',
        is_active: true,
        stages: [
            {
                name: '',
                prompt: '',
                generate_document: false,
            },
        ],
    };

    return {
        week_reports: {},
        fetchReports,

        editingColumn: { ticket: null, column: null },
        setEditingColumn: (ticket, column) => set({ editingColumn: { ticket, column } }),

        editingTicket: null,
        setEditingTicket: (ticket) => set({ editingTicket: ticket }),
        setEditingTicketToNew: () => {
            set({
                editingTicket: {
                    _id: '',
                    id: '',
                    name: '',
                    project: '',
                    task_type: '',
                    performer: '',
                    priority: '',
                    description: '',
                } as Ticket,
            });
        },

        editingEpic: null,
        setEditingEpic: (epic) => set({ editingEpic: epic }),
        setEditingEpicToNew: () => {
            set({
                editingEpic: {
                    _id: '',
                    name: '',
                    project: '',
                } as Epic,
            });
        },

        selectedNode: null,
        setSelectedNode: (data) => {
            if (!_.isEqual(data, get().selectedNode)) {
                set({ newEntityForm: null, editForm: null, editingNode: null });
            }
            set({ selectedNode: data });
        },

        editingNode: null,
        setEditingNode: (node) => set({ editingNode: node }),

        newEntityForm: null,
        setNewEntityForm: (formName) => set({ newEntityForm: formName }),

        editForm: null,
        setEditForm: (formName) => set({ editForm: formName }),

        isInActiveVisible: false,
        setIsInActiveVisible: (is_visible) => set({ isInActiveVisible: is_visible }),

        statusFilter: [],
        setStatusFilter: (filter) => set({ statusFilter: filter }),

        savedFilters: savedFilters as CRMFilters,
        saveFilters: (filters) => {
            set({ savedFilters: filters });
            cookies.set('crm-filters', filters, { path: '/' });
        },

        savedTab: savedTab,
        saveTab: (tab) => {
            const tabStr = tab.toString();
            set({ savedTab: tabStr });
            cookies.set('crm-tab', tabStr, { path: '/' });
        },

        all_statuses_stat: {},
        calculateStatusesStat: (tickets) => {
            const all_statuses_stat: Record<string, number> = {};
            if (tickets && tickets.length > 0) {
                for (const ticket of tickets) {
                    if (!ticket.task_status) continue;
                    const status = ticket.task_status;
                    if (all_statuses_stat[status] === undefined) {
                        all_statuses_stat[status] = 0;
                    }
                    all_statuses_stat[status]++;
                }
            }
            set({ all_statuses_stat });
        },

        commentedTicket: null,
        setCommentedTicket: (ticket) => set({ commentedTicket: ticket }),

        editingWorkHours: null,
        setEditingWorkHours: (ticket) => set({ editingWorkHours: ticket }),

        pairToSync: null,
        setPairToSync: async (pair) => {
            const pair_new_data = await api_request<{ dev_sections: { pages: unknown[] }; des_sections: { pages: unknown[] } }>(
                'figma/get-pair-files',
                { dev: pair.dev.fileKey, des: pair.des.fileKey }
            );
            pair.dev.pages = pair_new_data.dev_sections.pages as FigmaSyncPair['dev']['pages'];
            pair.des.pages = pair_new_data.des_sections.pages as FigmaSyncPair['des']['pages'];
            set({ pairToSync: pair });
        },
        clearPairToSync: () => set({ pairToSync: null }),

        secitionsToSync: {},
        addSectionToSync: (pair, page, section) => {
            const key = pair.dev.fileKey + '-' + page.node_id + '-' + section.node_id;
            set((state) => ({
                secitionsToSync: update(state.secitionsToSync, {
                    [key]: {
                        $set: {
                            source_file_url: pair.dev.fileUrl,
                            destination_file_url: pair.des.fileUrl,
                            source_file_id: pair.dev.fileKey,
                            destination_file_id: pair.des.fileKey,
                            page_name: page.name,
                            section_name: section.name,
                        },
                    },
                }),
            }));
        },
        removeSectionFromSync: (pair, page, section) => {
            const key = pair.dev.fileKey + '-' + page.node_id + '-' + section.node_id;
            set((state) => ({
                secitionsToSync: update(state.secitionsToSync, {
                    $unset: [key],
                }),
            }));
        },
        clearSectionsToSync: () =>
            set({
                secitionsToSync: {},
                currentMark: 0,
                selectedSections: {},
                selectedSectionMode: 'none',
                selectedSectionPairs: {},
            }),

        editTiketProject: null,
        setEditTiketProject: (p) => set({ editTiketProject: p }),

        currentMark: 0,
        selectedSectionPairs: {},
        selectedSections: {},
        selectedSectionMode: 'none',

        toggleSectionToSync: (pair, page, section, isDev) => {
            const mode = get().selectedSectionMode;
            const currentMark = get().currentMark;
            const key = (isDev ? 'dev-' + pair.dev.fileKey : 'des-' + pair.des.fileKey) + '-' + page.node_id + '-' + section.node_id;
            const sectionMark = get().selectedSections[key];
            const isNewSelected = sectionMark ? false : true;

            if (!isNewSelected && sectionMark !== currentMark) {
                const foundKeys: string[] = [];
                for (const [k, mark] of Object.entries(get().selectedSections)) {
                    if (mark === sectionMark) foundKeys.push(k);
                }
                set((state) => ({
                    selectedSections: update(state.selectedSections, { $unset: foundKeys }),
                    selectedSectionMode: 'none',
                }));
                return;
            }

            switch (mode) {
                case 'none':
                    if (isNewSelected) {
                        const nextMark = currentMark + 1;
                        set((state) => ({
                            currentMark: nextMark,
                            selectedSections: update(state.selectedSections, { [key]: { $set: nextMark } }),
                            selectedSectionMode: isDev ? 'select_des' : 'select_dev',
                        }));
                    } else {
                        set((state) => ({
                            selectedSections: update(state.selectedSections, { $unset: [key] }),
                            selectedSectionMode: isDev ? 'select_dev' : 'select_des',
                        }));
                    }
                    break;
                case 'select_des':
                    if (isDev) {
                        if (isNewSelected) break;
                    } else {
                        if (!isNewSelected) break;
                        set((state) => ({
                            selectedSections: update(state.selectedSections, { [key]: { $set: currentMark } }),
                            selectedSectionMode: 'none',
                        }));
                    }
                    break;
                case 'select_dev':
                    if (!isDev) {
                        if (isNewSelected) break;
                    } else {
                        if (!isNewSelected) break;
                        set((state) => ({
                            selectedSections: update(state.selectedSections, { [key]: { $set: currentMark } }),
                            selectedSectionMode: 'none',
                        }));
                    }
                    break;
            }
        },

        getSectionsToSync: () => {
            const selected = get().selectedSections;
            const pair = get().pairToSync;
            if (!pair) return [];

            const pairsKeys = Object.values(_.groupBy(Object.keys(selected), (key) => selected[key]));

            const toSync: Array<{ from: unknown; to: unknown }> = [];
            for (const pairKeys of pairsKeys) {
                let from: unknown = null;
                let to: unknown = null;
                for (const key of pairKeys) {
                    const obj: { page?: string; key?: string; section?: string } = {};
                    const [type, fileKey, pageNodeId, sectioneNodeId] = key.split('-');
                    const data = type === 'dev' ? pair.dev : type === 'des' ? pair.des : null;
                    if (!data?.pages) continue;
                    const page = _.find(data.pages, (p) => p.node_id === pageNodeId);
                    if (!page) continue;
                    obj.page = page.name;
                    obj.key = pageNodeId + '-' + sectioneNodeId;
                    const section = _.find(page.sections, (s) => s.node_id === sectioneNodeId);
                    if (section) obj.section = section.name;
                    if (type === 'dev') from = obj;
                    if (type === 'des') to = obj;
                }
                toSync.push({ from, to });
            }
            return toSync;
        },

        metricsMonth: dayjs().month() + 1,
        setMetricMonth: (m) => set({ metricsMonth: m }),

        metricsYear: dayjs().year(),
        setMetricYear: (y) => set({ metricsYear: y }),

        editedIncomeRow: null,
        setEditedIncomeRow: (d) => set({ editedIncomeRow: d }),

        isMonthWorkHoursChanged: false,
        setIsMonthWorkHoursChanged: (d) => set({ isMonthWorkHoursChanged: d }),

        approveModalOpen: null,
        setApproveModalOpen: (d) => set({ approveModalOpen: d }),

        emptyBotCommand,
        selectedBotCommand: _.clone(emptyBotCommand),
        setSelectedBotCommand: (d) => set({ selectedBotCommand: d }),

        testText: '',
        setTestText: (d) => set({ testText: d }),

        commandSearchText: '',
        setCommandSearchText: (d) => set({ commandSearchText: d }),

        clientFilter: null,
        setClientFilter: (d) => set({ clientFilter: d }),

        projectFilter: [],
        setProjectFilter: (d) => set({ projectFilter: d }),

        selectedProject: null,
        setSelectedProject: (d) => set({ selectedProject: d }),
    };
});
