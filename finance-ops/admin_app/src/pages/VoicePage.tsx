import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import PageHeader from '../components/PageHeader';

export default function VoicePage(): ReactElement {
  return (
    <div className="finops-page animate-fade-up">
      <PageHeader title="Voice" description="Раздел Voice находится в разработке." />
      <Card>
        <Typography.Text type="secondary">Скоро здесь появится функционал Voice.</Typography.Text>
      </Card>
    </div>
  );
}
