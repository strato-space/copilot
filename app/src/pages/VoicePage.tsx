import { Card, Typography } from 'antd';
import { type ReactElement } from 'react';
import EmbedFrame from '../components/EmbedFrame';
import PageHeader from '../components/PageHeader';

export default function VoicePage(): ReactElement {
  const baseUrl = import.meta.env.VITE_VOICE_EMBED_BASE_URL;

  if (!baseUrl) {
    return (
      <div className="finops-page animate-fade-up">
        <PageHeader title="Voice" description="Раздел Voice находится в разработке." />
        <Card>
          <Typography.Text type="secondary">Скоро здесь появится функционал Voice.</Typography.Text>
        </Card>
      </div>
    );
  }

  return (
    <EmbedFrame
      baseUrl={baseUrl}
      routeBase="/voice"
      title="Voice"
      className="finops-page"
    />
  );
}
