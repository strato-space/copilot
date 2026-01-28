import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import EmbedFrame from '../components/EmbedFrame';
import PageHeader from '../components/PageHeader';

export default function OperopsPage(): ReactElement {
  const baseUrl = import.meta.env.VITE_OPEROPS_EMBED_BASE_URL;

  if (!baseUrl) {
    return (
      <div className="finops-page animate-fade-up">
        <PageHeader title="OperOps" description="Раздел OperOps находится в разработке." />
        <Card>
          <Typography.Text type="secondary">Скоро здесь появится функционал OperOps.</Typography.Text>
        </Card>
      </div>
    );
  }

  return (
    <EmbedFrame
      baseUrl={baseUrl}
      routeBase="/operops"
      title="OperOps"
      className="finops-page"
    />
  );
}
