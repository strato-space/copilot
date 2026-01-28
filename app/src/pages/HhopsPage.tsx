import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import PageHeader from '../components/PageHeader';

export default function HhopsPage(): ReactElement {
  return (
    <div className="finops-page animate-fade-up">
      <PageHeader title="HHOps" description="Раздел HHOps находится в разработке." />
      <Card>
        <Typography.Text type="secondary">Скоро здесь появится функционал HHOps.</Typography.Text>
      </Card>
    </div>
  );
}
