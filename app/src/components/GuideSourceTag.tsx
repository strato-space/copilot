import { Tag } from 'antd';
import { type ReactElement } from 'react';
import { type GuideSource } from '../store/guideStore';

const SOURCE_META: Record<GuideSource, { label: string; color: string }> = {
  automation: { label: 'automation (CRM)', color: 'green' },
  manual: { label: 'manual', color: 'blue' },
  unavailable: { label: 'нет источника', color: 'red' },
  unknown: { label: 'неизвестно', color: 'default' },
};

interface GuideSourceTagProps {
  source?: GuideSource;
}

export default function GuideSourceTag({ source = 'unknown' }: GuideSourceTagProps): ReactElement {
  const meta = SOURCE_META[source];
  return (
    <Tag color={meta.color}>{meta.label}</Tag>
  );
}
