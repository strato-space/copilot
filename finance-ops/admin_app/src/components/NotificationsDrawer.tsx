import { Button, Drawer, Modal, Switch, Typography, notification, Input, InputNumber, Checkbox, FloatButton, message } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import NotificationsPanel from './NotificationsPanel';
import { useNotificationStore } from '../store/notificationStore';

interface AgentCommand {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  prompt: string;
}

const defaultCommands: AgentCommand[] = [
  {
    id: 'agent-summary',
    name: 'Сводка рисков',
    description: 'Кратко объясняет основные отклонения и риски.',
    enabled: true,
    prompt: 'Сделай краткую сводку по ключевым рискам и отклонениям.',
  },
  {
    id: 'agent-actions',
    name: 'Рекомендации на сегодня',
    description: '1–3 конкретных действия по проблемным точкам.',
    enabled: true,
    prompt: 'Дай 1–3 рекомендации, что исправить в первую очередь.',
  },
  {
    id: 'agent-forecast',
    name: 'Проверка прогноза',
    description: 'Подсвечивает проекты, где прогноз сильно расходится.',
    enabled: false,
    prompt: 'Проверь, где прогноз отклоняется от факта более чем на 30%.',
  },
];

export default function NotificationsDrawer(): ReactElement {
  const {
    isDrawerOpen,
    closeDrawer,
    openDrawer,
    items,
    readIds,
    mutedIds,
    pendingPopupIds,
    clearPendingPopups,
    triggerCheck,
    markAllRead,
    settings,
    updateSettings,
    runAgentCommand,
    contextLabel,
  } = useNotificationStore();

  const [commands, setCommands] = useState<AgentCommand[]>(defaultCommands);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentInput, setAgentInput] = useState<string>('');

  const unreadCount = useMemo(
    () => items.filter((item) => !readIds.has(item.id) && !mutedIds.has(item.id)).length,
    [items, readIds, mutedIds],
  );

  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    if (pendingPopupIds.length === 0) {
      return;
    }
    pendingPopupIds.forEach((id) => {
      const notice = items.find((item) => item.id === id);
      if (!notice) {
        return;
      }
      api.open({
        message: notice.title,
        description: notice.description,
        placement: 'topRight',
        duration: 5,
        icon: <RobotOutlined />,
        btn: (
          <Button size="small" type="primary" onClick={openDrawer}>
            Открыть
          </Button>
        ),
      });
    });
    clearPendingPopups();
  }, [pendingPopupIds, items, api, openDrawer, clearPendingPopups]);

  return (
    <>
      {contextHolder}
      <FloatButton
        icon={<RobotOutlined />}
        badge={{ count: unreadCount, size: 'small', overflowCount: 99 }}
        onClick={openDrawer}
        type="primary"
        style={{ right: 24, bottom: 24 }}
      />
      <Drawer
        title={
          <div className="flex flex-col">
            <span>агент</span>
            <Typography.Text type="secondary" className="text-xs">
              контекст:{contextLabel}
            </Typography.Text>
          </div>
        }
        open={isDrawerOpen}
        onClose={closeDrawer}
        width={360}
        styles={{
          body: {
            display: 'flex',
            flexDirection: 'column',
            padding: 16,
            gap: 16,
          },
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button size="small" onClick={(): void => setCommandsOpen(true)}>Команды</Button>
            <Button size="small" onClick={(): void => setSettingsOpen(true)}>⚙</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="small" onClick={markAllRead}>Очистить</Button>
            <Button size="small" onClick={(): void => triggerCheck('refresh')}>Проверить</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <NotificationsPanel showHeader={false} />
        </div>
        <div className="finops-agent-input">
          <Input
            value={agentInput}
            onChange={(event): void => setAgentInput(event.target.value)}
            placeholder="Введите сообщение…"
            onPressEnter={(): void => {
              if (!agentInput.trim()) {
                return;
              }
              message.info('Скоро: отправка в агент');
              setAgentInput('');
            }}
          />
        </div>
      </Drawer>

      <Modal
        title="Команды агента"
        open={commandsOpen}
        onCancel={(): void => setCommandsOpen(false)}
        footer={null}
      >
        <div className="flex flex-col gap-4">
          {commands.map((command) => (
            <div key={command.id} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Typography.Text className="font-medium">{command.name}</Typography.Text>
                  <Typography.Paragraph type="secondary" className="!mb-0">
                    {command.description}
                  </Typography.Paragraph>
                </div>
                <Switch
                  checked={command.enabled}
                  onChange={(value): void => {
                    setCommands((prev) => prev.map((item) => (item.id === command.id ? { ...item, enabled: value } : item)));
                  }}
                />
              </div>
              <Typography.Text type="secondary" className="text-xs">Промпт</Typography.Text>
              <Typography.Paragraph className="!mb-2">{command.prompt}</Typography.Paragraph>
              <Button
                size="small"
                type="primary"
                disabled={!command.enabled}
                onClick={(): void => {
                  const created = runAgentCommand(command.id);
                  if (!created) {
                    message.info('Проблем не найдено');
                  }
                  setCommandsOpen(false);
                }}
              >
                Запустить
              </Button>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        title="Настройки уведомлений"
        open={settingsOpen}
        onCancel={(): void => setSettingsOpen(false)}
        footer={null}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Typography.Text>Всплывашки: Critical</Typography.Text>
            <Switch
              checked={settings.popupCritical}
              onChange={(value): void => updateSettings({ popupCritical: value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Typography.Text>Всплывашки: Warning</Typography.Text>
            <Switch
              checked={settings.popupWarning}
              onChange={(value): void => updateSettings({ popupWarning: value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Typography.Text>Максимум всплывашек</Typography.Text>
            <InputNumber
              min={1}
              max={5}
              value={settings.popupLimit}
              onChange={(value): void => updateSettings({ popupLimit: Number(value ?? settings.popupLimit) })}
            />
          </div>
          <div>
            <Typography.Text>Теги для всплывашек</Typography.Text>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(settings.popupTags).map(([tag, enabled]) => (
                <Checkbox
                  key={tag}
                  checked={enabled}
                  onChange={(event): void =>
                    updateSettings({ popupTags: { [tag]: event.target.checked } })
                  }
                >
                  {tag}
                </Checkbox>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
