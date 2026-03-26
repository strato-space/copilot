import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import PossibleTasks from '../../src/components/voice/PossibleTasks';
import { useVoiceBotStore } from '../../src/store/voiceBotStore';
import type { VoicePossibleTask } from '../../src/types/voice';

const mockHasPermission = jest.fn(() => true);
const mockAuthStoreGetState = jest.fn(() => ({
  authToken: 'test-token',
  user: null,
  permissions: [],
}));
const mockMcpRequestStoreGetState = jest.fn(() => ({
  sendMCPCall: jest.fn(),
  waitForCompletion: jest.fn(async () => ({ status: 'completed', result: null })),
}));
const mockSessionsUIState = {
  participantModal: {} as unknown,
  accessUsersModal: {} as unknown,
  selectedCategorizationRows: [],
  materialTargetMessageId: null as string | null,
  categorizationSort: { ascending: false },
  transcriptionSort: { ascending: false },
  ticketsModal: {
    visible: false,
    loading: false,
    tickets: null as Array<Record<string, unknown>> | null,
    selectedTicketIds: [] as string[],
    editingTickets: {} as Record<string, unknown>,
    savedChanges: {} as Record<string, unknown>,
  },
  setMaterialTargetMessageId: jest.fn(),
  closeTicketsModal: jest.fn(),
};

jest.mock('../../src/store/authStore', () => ({
  useAuthStore: Object.assign(() => ({ user: null, permissions: [] }), {
    getState: () => mockAuthStoreGetState(),
  }),
}));

jest.mock('../../src/store/mcpRequestStore', () => ({
  useMCPRequestStore: {
    getState: () => mockMcpRequestStoreGetState(),
  },
}));

jest.mock('../../src/services/socket', () => ({
  SOCKET_EVENTS: {},
  getVoicebotSocket: jest.fn(() => null),
}));

jest.mock('../../src/store/voicebotRuntimeConfig', () => ({
  voicebotRuntimeConfig: {
    getBackendUrl: () => '/api',
    getProxyConfig: () => null,
    resolveAgentsMcpServerUrl: () => 'http://127.0.0.1:8722',
    normalizeIncludeIds: (includeIds: string[] | undefined) => (Array.isArray(includeIds) ? includeIds : []),
  },
}));

jest.mock('../../src/store/sessionsUIStore', () => {
  const useSessionsUIStore = Object.assign(
    (selector: (state: typeof mockSessionsUIState) => unknown) => selector(mockSessionsUIState),
    {
      getState: () => mockSessionsUIState,
      setState: (
        update:
          | Partial<typeof mockSessionsUIState>
          | ((state: typeof mockSessionsUIState) => Partial<typeof mockSessionsUIState>),
        replace = false
      ) => {
        const nextPartial = typeof update === 'function' ? update(mockSessionsUIState) : update;
        if (replace) {
          for (const key of Object.keys(mockSessionsUIState) as Array<keyof typeof mockSessionsUIState>) {
            delete (mockSessionsUIState as Record<string, unknown>)[key as string];
          }
          Object.assign(mockSessionsUIState, nextPartial);
          return;
        }
        Object.assign(mockSessionsUIState, nextPartial);
      },
    }
  );

  return { useSessionsUIStore };
});

jest.mock('../../src/store/permissionsStore', () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: mockHasPermission,
  }),
}));

jest.mock('../../src/hooks/useHydratedProjectOptions', () => ({
  useHydratedProjectOptions: () => ({
    hydratedProjects: [],
    groupedProjectOptions: [
      {
        label: 'Default',
        title: 'Default',
        options: [{ label: 'Project One', value: 'proj-1', title: 'Project One', searchLabel: 'Project One' }],
      },
    ],
    projectLabelById: new Map([['proj-1', 'Project One']]),
    projectHierarchyLabelById: new Map([['proj-1', 'Ops']]),
  }),
}));

type RenderHandle = {
  container: HTMLDivElement;
  unmount: () => void;
};

const renderIntoDom = (node: ReactElement): RenderHandle => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const createTask = (patch: Partial<VoicePossibleTask>): VoicePossibleTask =>
  ({
    row_id: 'row-1',
    id: 'row-1',
    name: 'Task',
    description: 'Description',
    priority: 'P2',
    performer_id: 'perf-1',
    project_id: 'proj-1',
    task_type_id: 'tt-1',
    dialogue_tag: 'voice',
    task_id_from_ai: 'ai-1',
    dependencies_from_ai: [],
    ...patch,
  }) as VoicePossibleTask;

describe('PossibleTasks performer lifecycle contract', () => {
  const initialVoiceState = useVoiceBotStore.getState();

  beforeAll(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      writable: true,
      value: true,
    });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });

    class ResizeObserverMock {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      writable: true,
      value: ResizeObserverMock,
    });
  });

  beforeEach(() => {
    mockHasPermission.mockReturnValue(true);
  });

  afterEach(() => {
    useVoiceBotStore.setState(initialVoiceState, true);
    mockAuthStoreGetState.mockClear();
    mockMcpRequestStoreGetState.mockClear();
    mockHasPermission.mockClear();
  });

  it('requests performer selector list with historical ids when active list misses assigned performer ids', async () => {
    const fetchPerformersForTasksList = jest.fn(async () => []);

    useVoiceBotStore.setState((state) => ({
      ...state,
      voiceBotSession: { _id: 'session-1', project_id: 'proj-1' } as any,
      possibleTasks: [
        createTask({ row_id: 'row-1', performer_id: 'archived-1' }),
        createTask({ row_id: 'row-2', performer_id: 'missing-2' }),
      ],
      performers_for_tasks_list: [{ _id: 'archived-1', full_name: 'Архивный Иван', is_active: false }],
      prepared_projects: [{ _id: 'proj-1', name: 'Project One' }],
      task_types: [],
      fetchPerformersForTasksList,
      fetchPreparedProjects: jest.fn(async () => undefined),
      fetchTaskTypes: jest.fn(async () => []),
      saveSessionPossibleTasks: jest.fn(async () => []),
      confirmSelectedTickets: jest.fn(async () => ({ createdTaskIds: [], removedRowIds: [], rowErrors: [] })),
      deleteTaskFromSession: jest.fn(async () => undefined),
    }));

    const view = renderIntoDom(React.createElement(PossibleTasks));

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(fetchPerformersForTasksList).toHaveBeenCalledTimes(1);
      const includeIds = fetchPerformersForTasksList.mock.calls[0]?.[0] as string[];
      expect(includeIds).toEqual(expect.arrayContaining(['archived-1', 'missing-2']));
    } finally {
      view.unmount();
    }
  });

  it('keeps archived performer assignments user-visible with explicit archived labels', () => {
    useVoiceBotStore.setState((state) => ({
      ...state,
      voiceBotSession: { _id: 'session-1', project_id: 'proj-1' } as any,
      possibleTasks: [
        createTask({
          row_id: 'row-1',
          name: 'Task with archived performer',
          performer_id: 'archived-1',
        }),
        createTask({
          row_id: 'row-2',
          name: 'Task with unknown performer',
          performer_id: 'missing-2',
        }),
      ],
      performers_for_tasks_list: [{ _id: 'archived-1', full_name: 'Архивный Иван', is_active: false }],
      prepared_projects: [{ _id: 'proj-1', name: 'Project One' }],
      task_types: [],
      fetchPerformersForTasksList: jest.fn(async () => []),
      fetchPreparedProjects: jest.fn(async () => undefined),
      fetchTaskTypes: jest.fn(async () => []),
      saveSessionPossibleTasks: jest.fn(async () => []),
      confirmSelectedTickets: jest.fn(async () => ({ createdTaskIds: [], removedRowIds: [], rowErrors: [] })),
      deleteTaskFromSession: jest.fn(async () => undefined),
    }));

    const view = renderIntoDom(React.createElement(PossibleTasks));

    try {
      const text = view.container.textContent ?? '';
      expect(text).toContain('Архивный Иван (архив)');
      expect(text).toContain('Архивный исполнитель');
    } finally {
      view.unmount();
    }
  });
});
