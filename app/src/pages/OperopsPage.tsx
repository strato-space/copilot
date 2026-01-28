import { type ReactElement } from 'react';
import EmbedFrame from '../components/EmbedFrame';

export default function OperopsPage(): ReactElement {
  const baseUrl = import.meta.env.VITE_OPEROPS_EMBED_BASE_URL;

  if (!baseUrl) {
    return (
      <div className="finops-page">
        <div className="text-slate-500">Embed URL для OperOps не настроен.</div>
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
