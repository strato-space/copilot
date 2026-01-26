import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import PageHeader from '../components/PageHeader';

export default function ChatopsPage(): ReactElement {
  return (
    <div className="finops-page animate-fade-up">
      <PageHeader title="ChatOps" description="Раздел ChatOps находится в разработке." />
      <Card>
        <Typography.Text type="secondary">Скоро здесь появится функционал ChatOps.</Typography.Text>
      </Card>
    </div>
  );
}
