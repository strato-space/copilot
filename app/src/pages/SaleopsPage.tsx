import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import PageHeader from '../components/PageHeader';

export default function SaleopsPage(): ReactElement {
  return (
    <div className="finops-page animate-fade-up">
      <PageHeader title="SaleOps" description="Раздел SaleOps находится в разработке." />
      <Card>
        <Typography.Text type="secondary">Скоро здесь появится функционал SaleOps.</Typography.Text>
      </Card>
    </div>
  );
}
