import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import PageHeader from '../components/PageHeader';

export default function OperopsPage(): ReactElement {
  return (
    <div className="finops-page animate-fade-up">
      <PageHeader title="OperOps" description="Раздел OperOps временно отключен и находится в режиме заглушки." />
      <Card>
        <Typography.Text type="secondary">
          Здесь будет восстановлен функционал OperOps после проверки и обновления требований.
        </Typography.Text>
      </Card>
    </div>
  );
}
