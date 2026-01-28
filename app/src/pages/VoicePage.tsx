import { type ReactElement } from 'react';
import EmbedFrame from '../components/EmbedFrame';

export default function VoicePage(): ReactElement {
  const baseUrl = import.meta.env.VITE_VOICE_EMBED_BASE_URL;

  if (!baseUrl) {
    return (
      <div className="finops-page">
        <div className="text-slate-500">Embed URL для Voice не настроен.</div>
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
