import { Button, Tag, Typography } from 'antd';
import { type ReactElement, useMemo } from 'react';
import { useNotificationStore } from '../store/notificationStore';

interface Props {
  showHeader?: boolean;
}

const isAction = (label: string, action: string): boolean =>
  label.toLowerCase().includes(action);

export default function NotificationsPanel({ showHeader = true }: Props): ReactElement {
  const {
    items,
    filterTag,
    toggleFilterTag,
    markAllRead,
    markRead,
    mute,
    snooze,
  } = useNotificationStore();

  const visibleItems = useMemo(() => {
    if (!filterTag) {
      return items;
    }
    return items.filter((item) => item.tags.some((tag) => tag.label === filterTag));
  }, [items, filterTag]);

  return (
    <div className="finops-notifications-list">
      {showHeader && (
        <div className="flex items-center justify-between mb-2">
          <Typography.Title level={5} className="!mb-0">
            Уведомления
          </Typography.Title>
          <Button size="small" onClick={markAllRead}>Очистить</Button>
        </div>
      )}
      {filterTag && (
        <div className="flex items-center gap-2">
          <Typography.Text type="secondary" className="text-xs">Фильтр:</Typography.Text>
          <Tag closable onClose={(): void => toggleFilterTag(filterTag)}>{filterTag}</Tag>
        </div>
      )}
      {visibleItems.map((notice) => (
        <div key={notice.id} className="finops-notification-item">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {notice.tags.map((tag, index) => (
                <Tag
                  key={`${notice.id}-tag-${index}`}
                  color={tag.color}
                  onClick={(): void => toggleFilterTag(tag.label)}
                >
                  {tag.label}
                </Tag>
              ))}
            </div>
            <Typography.Text type="secondary" className="text-xs">
              {notice.timeLabel}
            </Typography.Text>
          </div>
          <Typography.Text className="font-medium text-slate-900">{notice.title}</Typography.Text>
          <Typography.Paragraph type="secondary" className="!mb-0">
            {notice.description}
          </Typography.Paragraph>
          <div className="flex flex-wrap gap-2">
            {notice.actions.map((action) => (
              <Button
                key={`${notice.id}-${action}`}
                size="small"
                onClick={(): void => {
                  if (isAction(action, 'позже')) {
                    snooze(notice.id, 24);
                    return;
                  }
                  if (isAction(action, 'скры')) {
                    mute(notice.id);
                    return;
                  }
                  markRead(notice.id);
                }}
              >
                {action}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
