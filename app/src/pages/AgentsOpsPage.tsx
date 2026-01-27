import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import PageHeader from '../components/PageHeader';

export default function AgentsOpsPage(): ReactElement {
  return (
    <div className="finops-page animate-fade-up">
      <PageHeader title="Agents" description="Раздел Agents находится в разработке." />
      <Card>
        <Typography.Text type="secondary">
          Здесь появятся агенты и сценарии автоматизации для OPS (пока заглушка).
        </Typography.Text>
      </Card>
    </div>
  );
}
