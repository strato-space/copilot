import { create } from 'zustand';
import dayjs from 'dayjs';

export type NotificationSeverity = 'critical' | 'warning' | 'info';

export interface NotificationTag {
  label: string;
  color: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  tags: NotificationTag[];
  severity: NotificationSeverity;
  createdAt: string;
  timeLabel: string;
  actions: string[];
  context?: string;
}

export interface NotificationSettings {
  popupCritical: boolean;
  popupWarning: boolean;
  popupLimit: number;
  popupTags: Record<string, boolean>;
}

interface NotificationState {
  items: NotificationItem[];
  readIds: Set<string>;
  mutedIds: Set<string>;
  snoozedUntil: Record<string, string>;
  filterTag: string | null;
  contextLabel: string;
  pendingPopupIds: string[];
  settings: NotificationSettings;
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleFilterTag: (tag: string) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  mute: (id: string) => void;
  snooze: (id: string, hours?: number) => void;
  addAgentNotification: (title: string, description: string) => void;
  runAgentCommand: (commandId: string) => boolean;
  setContextLabel: (label: string) => void;
  updateSettings: (patch: Partial<NotificationSettings>) => void;
  triggerCheck: (source: 'analytics' | 'refresh' | 'agent') => void;
  clearPendingPopups: () => void;
}

const STORAGE_READ = 'finopsNotificationsRead';
const STORAGE_MUTED = 'finopsNotificationsMuted';
const STORAGE_SNOOZE = 'finopsNotificationsSnooze';
const STORAGE_SETTINGS = 'finopsNotificationSettings';

const defaultSettings: NotificationSettings = {
  popupCritical: true,
  popupWarning: false,
  popupLimit: 3,
  popupTags: {
    Марж: true,
    Откл: true,
    Часы: true,
    FX: true,
    Данн: true,
    Агент: true,
  },
};

const initialNotifications: NotificationItem[] = [
  {
    id: 'notice-1',
    tags: [
      { label: 'Часы', color: 'orange' },
      { label: 'Часы', color: 'blue' },
    ],
    timeLabel: 'только что',
    createdAt: '2026-01-22T09:05:00+03:00',
    severity: 'critical',
    title: '14 часов не выставлено на продажу',
    description: 'Факт есть, но нет выручки — проверьте Metro QAudit.',
    actions: ['Исправить', 'Позже', 'Скрыть'],
  },
  {
    id: 'notice-2',
    tags: [
      { label: 'Марж', color: 'green' },
      { label: 'Данн', color: 'blue' },
    ],
    timeLabel: '2 мин назад',
    createdAt: '2026-01-22T09:02:00+03:00',
    severity: 'warning',
    title: 'Маржа проекта Hearts Rockstar отрицательная',
    description: '180 600 ₽, прибыль −100%.',
    actions: ['Исправить', 'Скрыть'],
  },
  {
    id: 'notice-3',
    tags: [
      { label: 'Откл', color: 'blue' },
      { label: 'Откл', color: 'cyan' },
    ],
    timeLabel: '5 мин назад',
    createdAt: '2026-01-22T09:00:00+03:00',
    severity: 'info',
    title: 'Metro Maps отстаёт от прогноза на −50%',
    description: 'Факт: 67 100 ₽, прогноз: 186 000 ₽.',
    actions: ['Исправить', 'Скрыть'],
  },
  {
    id: 'notice-4',
    tags: [
      { label: 'FX', color: 'gold' },
    ],
    timeLabel: '4 дня назад',
    createdAt: '2026-01-18T09:00:00+03:00',
    severity: 'warning',
    title: 'Курс USD введён вручную',
    description: 'Проверьте FX и откорректируйте.',
    actions: ['Исправить'],
  },
];

const loadSet = (key: string): Set<string> => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
};

const saveSet = (key: string, value: Set<string>): void => {
  localStorage.setItem(key, JSON.stringify(Array.from(value)));
};

const loadSettings = (): NotificationSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    if (!raw) {
      return defaultSettings;
    }
    const parsed = JSON.parse(raw) as NotificationSettings;
    return { ...defaultSettings, ...parsed, popupTags: { ...defaultSettings.popupTags, ...parsed.popupTags } };
  } catch {
    return defaultSettings;
  }
};

const saveSettings = (settings: NotificationSettings): void => {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
};

const loadSnoozed = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(STORAGE_SNOOZE);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
};

const saveSnoozed = (value: Record<string, string>): void => {
  localStorage.setItem(STORAGE_SNOOZE, JSON.stringify(value));
};

const severityWeight: Record<NotificationSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export const useNotificationStore = create<NotificationState>((set, get): NotificationState => ({
  items: initialNotifications,
  readIds: typeof window === 'undefined' ? new Set() : loadSet(STORAGE_READ),
  mutedIds: typeof window === 'undefined' ? new Set() : loadSet(STORAGE_MUTED),
  snoozedUntil: typeof window === 'undefined' ? {} : loadSnoozed(),
  filterTag: null,
  contextLabel: 'Аналитика',
  pendingPopupIds: [],
  settings: typeof window === 'undefined' ? defaultSettings : loadSettings(),
  isDrawerOpen: false,
  openDrawer: (): void => set({ isDrawerOpen: true }),
  closeDrawer: (): void => set({ isDrawerOpen: false }),
  toggleFilterTag: (tag: string): void => {
    const current = get().filterTag;
    set({ filterTag: current === tag ? null : tag });
  },
  markAllRead: (): void => {
    const readIds = new Set(get().items.map((item) => item.id));
    saveSet(STORAGE_READ, readIds);
    set({ readIds });
  },
  markRead: (id: string): void => {
    const readIds = new Set(get().readIds);
    readIds.add(id);
    saveSet(STORAGE_READ, readIds);
    set({ readIds });
  },
  mute: (id: string): void => {
    const mutedIds = new Set(get().mutedIds);
    mutedIds.add(id);
    saveSet(STORAGE_MUTED, mutedIds);
    set({ mutedIds });
  },
  snooze: (id: string, hours = 24): void => {
    const snoozedUntil = { ...get().snoozedUntil };
    snoozedUntil[id] = dayjs().add(hours, 'hour').toISOString();
    saveSnoozed(snoozedUntil);
    set({ snoozedUntil });
  },
  addAgentNotification: (title: string, description: string): void => {
    const now = dayjs();
    const newItem: NotificationItem = {
      id: `agent-${now.valueOf()}`,
      title,
      description,
      severity: 'info',
      createdAt: now.toISOString(),
      timeLabel: 'только что',
      tags: [{ label: 'Агент', color: 'purple' }],
      actions: ['Открыть', 'Скрыть'],
      context: get().contextLabel,
    };
    set({ items: [newItem, ...get().items] });
  },
  runAgentCommand: (commandId: string): boolean => {
    const { items, mutedIds, snoozedUntil, contextLabel } = get();
    const now = dayjs();
    const activeItems = items.filter((item) => {
      if (mutedIds.has(item.id)) {
        return false;
      }
      const snoozeUntil = snoozedUntil[item.id];
      return !snoozeUntil || dayjs(snoozeUntil).isBefore(now);
    });
    if (activeItems.length === 0) {
      return false;
    }
    const sortBySeverity = (a: NotificationItem, b: NotificationItem): number => {
      const diff = severityWeight[b.severity] - severityWeight[a.severity];
      if (diff !== 0) {
        return diff;
      }
      return dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf();
    };
    const topItems = [...activeItems].sort(sortBySeverity);
    if (commandId === 'agent-summary') {
      const criticalCount = activeItems.filter((item) => item.severity === 'critical').length;
      const warningCount = activeItems.filter((item) => item.severity === 'warning').length;
      const titles = topItems.slice(0, 3).map((item) => `• ${item.title}`).join('\n');
      const description = [
        `Критичных: ${criticalCount}, предупреждений: ${warningCount}.`,
        titles,
      ]
        .filter(Boolean)
        .join('\n');
      get().addAgentNotification('Сводка рисков', description);
      return true;
    }
    if (commandId === 'agent-actions') {
      const actions = topItems.slice(0, 3).map((item) => `• Проверьте: ${item.title}`);
      if (actions.length === 0) {
        return false;
      }
      get().addAgentNotification('Рекомендации на сегодня', actions.join('\n'));
      return true;
    }
    if (commandId === 'agent-forecast') {
      const deviations = activeItems.filter((item) =>
        item.tags.some((tag) => tag.label === 'Откл'),
      );
      if (deviations.length === 0) {
        return false;
      }
      const titles = deviations.slice(0, 3).map((item) => `• ${item.title}`).join('\n');
      const description = `Найдено отклонений: ${deviations.length}.\n${titles}`;
      get().addAgentNotification('Проверка прогноза', description);
      return true;
    }
    const fallbackDescription = topItems
      .slice(0, 2)
      .map((item) => `• ${item.title}`)
      .join('\n');
    get().addAgentNotification(`Команда ${commandId}`, fallbackDescription || `Контекст: ${contextLabel}`);
    return true;
  },
  setContextLabel: (label: string): void => set({ contextLabel: label }),
  updateSettings: (patch: Partial<NotificationSettings>): void => {
    const settings = { ...get().settings, ...patch, popupTags: { ...get().settings.popupTags, ...patch.popupTags } };
    saveSettings(settings);
    set({ settings });
  },
  triggerCheck: (_source: 'analytics' | 'refresh' | 'agent'): void => {
    const { items, readIds, mutedIds, snoozedUntil, settings } = get();
    const now = dayjs();
    const candidates = items.filter((item) => {
      if (readIds.has(item.id) || mutedIds.has(item.id)) {
        return false;
      }
      const snoozeUntil = snoozedUntil[item.id];
      if (snoozeUntil && dayjs(snoozeUntil).isAfter(now)) {
        return false;
      }
      if (item.severity === 'critical' && !settings.popupCritical) {
        return false;
      }
      if (item.severity === 'warning' && !settings.popupWarning) {
        return false;
      }
      const tagAllowed = item.tags.every((tag) => settings.popupTags[tag.label] !== false);
      return tagAllowed;
    });
    const ordered = [...candidates].sort((a, b) => {
      const severityDiff = severityWeight[b.severity] - severityWeight[a.severity];
      if (severityDiff !== 0) {
        return severityDiff;
      }
      return dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf();
    });
    const popupIds = ordered.slice(0, settings.popupLimit).map((item) => item.id);
    if (popupIds.length) {
      const nextSnoozed = { ...snoozedUntil };
      popupIds.forEach((id) => {
        nextSnoozed[id] = now.add(24, 'hour').toISOString();
      });
      saveSnoozed(nextSnoozed);
      set({ pendingPopupIds: popupIds, snoozedUntil: nextSnoozed });
      return;
    }
    set({ pendingPopupIds: [] });
  },
  clearPendingPopups: (): void => set({ pendingPopupIds: [] }),
}));
