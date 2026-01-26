import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import PageHeader from '../components/PageHeader';

export default function DesopsPage(): ReactElement {
  return (
    <div className="finops-page animate-fade-up">
      <PageHeader title="DesOps" description="Раздел DesOps находится в разработке." />
      <Card>
        <Typography.Text type="secondary">
          Здесь будут инструменты DesOps (пока заглушка).
        </Typography.Text>
      </Card>
    </div>
  );
}
