import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { message } from 'antd';

import PossibleTasks from '../../src/components/voice/PossibleTasks';
import { useSessionsUIStore } from '../../src/store/sessionsUIStore';
import { useVoiceBotStore } from '../../src/store/voiceBotStore';
import { voicebotHttp } from '../../src/store/voicebotHttp';
import type { VoicePossibleTask } from '../../src/types/voice';

const mockHasPermission = jest.fn(() => true);
const mockVoicebotRequest = jest.fn();
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

const resetMockSessionsUIState = (): void => {
  mockSessionsUIState.participantModal = {} as unknown;
  mockSessionsUIState.accessUsersModal = {} as unknown;
  mockSessionsUIState.selectedCategorizationRows = [];
  mockSessionsUIState.materialTargetMessageId = null;
  mockSessionsUIState.categorizationSort = { ascending: false };
  mockSessionsUIState.transcriptionSort = { ascending: false };
  mockSessionsUIState.ticketsModal = {
    visible: false,
    loading: false,
    tickets: null,
    selectedTicketIds: [],
    editingTickets: {},
    savedChanges: {},
  };
  mockSessionsUIState.setMaterialTargetMessageId = jest.fn();
  mockSessionsUIState.closeTicketsModal = jest.fn();
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

jest.mock('../../src/store/voicebotHttp', () => ({
  voicebotHttp: {
    request: (...args: unknown[]) => mockVoicebotRequest(...args),
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

describe('PossibleTasks post-create contract', () => {
  const initialVoiceState = useVoiceBotStore.getState();
  let infoSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

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
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(message, 'error').mockImplementation(() => undefined);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    useVoiceBotStore.setState(initialVoiceState, true);
    resetMockSessionsUIState();
    jest.restoreAllMocks();
    mockVoicebotRequest.mockReset();
    mockAuthStoreGetState.mockClear();
    mockMcpRequestStoreGetState.mockClear();
    mockHasPermission.mockClear();
  });

  it('removes successfully created rows from possibleTasks by created_task_ids via store action', async () => {
    const successSpy = jest.spyOn(message, 'success').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(message, 'error').mockImplementation(() => undefined);
    mockVoicebotRequest.mockResolvedValue({
      created_task_ids: ['row-1'],
    });
    const closeTicketsModal = jest.fn();

    useSessionsUIStore.setState((state) => ({
      ...state,
      closeTicketsModal,
      ticketsModal: {
        ...state.ticketsModal,
        tickets: null,
      },
    }));

    useVoiceBotStore.setState((state) => ({
      ...state,
      currentSessionId: 'session-1',
      prepared_projects: [{ _id: 'proj-1', name: 'Project One' }],
      possibleTasks: [createTask({ row_id: 'row-1', id: 'row-1' }), createTask({ row_id: 'row-2', id: 'row-2' })],
    }));

    const payloadRow = createTask({ row_id: 'row-1', id: 'row-1' });
    const result = await useVoiceBotStore.getState().confirmSelectedTickets(['row-1'], [payloadRow]);

    expect(result.createdTaskIds).toEqual(['row-1']);
    expect(result.removedRowIds).toEqual(['row-1']);
    expect(useVoiceBotStore.getState().possibleTasks.map((task) => task.row_id)).toEqual(['row-2']);
    expect(closeTicketsModal).toHaveBeenCalledTimes(1);
    expect(mockVoicebotRequest).toHaveBeenCalledWith(
      'voicebot/process_possible_tasks',
      expect.objectContaining({
        session_id: 'session-1',
      })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[voice.possible_tasks] process_possible_tasks.request',
      expect.objectContaining({
        sessionId: 'session-1',
        selectedRowIds: ['row-1'],
        selectedCount: 1,
      })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[voice.possible_tasks] process_possible_tasks.response',
      expect.objectContaining({
        sessionId: 'session-1',
        createdTaskIds: ['row-1'],
        removedRowIds: ['row-1'],
        rowErrorsCount: 0,
      })
    );
    expect(successSpy).toHaveBeenCalledWith('Создано 1 задач');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('exposes a user-invokable Run affordance that materializes only the active row', async () => {
    const confirmSelectedTickets = jest.fn(async () => ({
      createdTaskIds: ['row-1'],
      removedRowIds: ['row-1'],
      rowErrors: [],
    }));

    useVoiceBotStore.setState((state) => ({
      ...state,
      voiceBotSession: { _id: 'session-1', project_id: 'proj-1' } as any,
      possibleTasks: [
        createTask({
          row_id: 'row-1',
          id: 'row-1',
          name: 'Materialize me',
          description: 'Row-level run contract',
          performer_id: 'perf-1',
          project_id: 'proj-1',
          priority: 'P2',
        }),
      ],
      performers_for_tasks_list: [{ _id: 'perf-1', full_name: 'Исполнитель 1', is_active: true }],
      prepared_projects: [{ _id: 'proj-1', name: 'Project One' }],
      task_types: [],
      fetchPerformersForTasksList: jest.fn(async () => []),
      fetchPreparedProjects: jest.fn(async () => undefined),
      fetchTaskTypes: jest.fn(async () => []),
      saveSessionPossibleTasks: jest.fn(async () => []),
      confirmSelectedTickets,
      deleteTaskFromSession: jest.fn(async () => undefined),
    }));

    const view = renderIntoDom(React.createElement(PossibleTasks));

    try {
      const runButton = view.container.querySelector('button[aria-label="Run"]');
      const saveButton = view.container.querySelector('button[aria-label="Save"], button[aria-label="Сохранить"]');
      expect(runButton).not.toBeNull();
      expect(saveButton).toBeNull();

      await act(async () => {
        runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(confirmSelectedTickets).toHaveBeenCalledTimes(1);
      expect(confirmSelectedTickets).toHaveBeenCalledWith(
        ['row-1'],
        [
          expect.objectContaining({
            row_id: 'row-1',
            performer_id: 'perf-1',
            project_id: 'proj-1',
            priority: 'P2',
          }),
        ]
      );
      expect(infoSpy).toHaveBeenCalledWith(
        '[voice.possible_tasks] run.submit',
        expect.objectContaining({
          sessionId: 'session-1',
          rowId: 'row-1',
          performer_id: 'perf-1',
          routing: 'human',
        })
      );
      expect(infoSpy).toHaveBeenCalledWith(
        '[voice.possible_tasks] run.result',
        expect.objectContaining({
          sessionId: 'session-1',
          rowId: 'row-1',
          routing: 'human',
        })
      );
    } finally {
      view.unmount();
    }
  });

  it('does not run a row when manual autosave fails for pending draft edits', async () => {
    const confirmSelectedTickets = jest.fn(async () => ({
      createdTaskIds: ['row-1'],
      removedRowIds: ['row-1'],
      rowErrors: [],
    }));
    const saveSessionPossibleTasks = jest.fn(async () => {
      throw new Error('autosave failed');
    });

    useVoiceBotStore.setState((state) => ({
      ...state,
      voiceBotSession: { _id: 'session-1', project_id: 'proj-1' } as any,
      possibleTasks: [
        createTask({
          row_id: 'row-1',
          id: 'row-1',
          name: 'Materialize me',
          description: 'Row-level run contract',
          performer_id: 'perf-1',
          project_id: 'proj-1',
          priority: 'P2',
        }),
      ],
      performers_for_tasks_list: [{ _id: 'perf-1', full_name: 'Исполнитель 1', is_active: true }],
      prepared_projects: [{ _id: 'proj-1', name: 'Project One' }],
      task_types: [],
      fetchPerformersForTasksList: jest.fn(async () => []),
      fetchPreparedProjects: jest.fn(async () => undefined),
      fetchTaskTypes: jest.fn(async () => []),
      saveSessionPossibleTasks,
      confirmSelectedTickets,
      deleteTaskFromSession: jest.fn(async () => undefined),
    }));

    const view = renderIntoDom(React.createElement(PossibleTasks));

    try {
      const nameField = view.container.querySelector('input[value="Materialize me"]');
      expect(nameField).not.toBeNull();

      await act(async () => {
        nameField?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        if (nameField instanceof HTMLInputElement) {
          const valueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          )?.set;
          valueSetter?.call(nameField, 'Updated draft name');
        }
        nameField?.dispatchEvent(new Event('input', { bubbles: true }));
        nameField?.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const runButton = view.container.querySelector('button[aria-label="Run"]');
      expect(runButton).not.toBeNull();

      await act(async () => {
        runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(saveSessionPossibleTasks).toHaveBeenCalledTimes(1);
      expect(confirmSelectedTickets).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Не удалось сохранить черновик');
      expect(infoSpy).not.toHaveBeenCalledWith(
        '[voice.possible_tasks] run.submit',
        expect.anything()
      );
    } finally {
      view.unmount();
    }
  });
});
