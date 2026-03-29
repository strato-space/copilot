import { type ReactElement, useLayoutEffect } from 'react';
import {
  AcpUiApp,
  createAcpUiHarnessBridge,
  resetAcpHostBridge,
  seedAcpUiHarnessState,
  setAcpHostBridge,
} from '@strato-space/acp-ui';
import '@strato-space/acp-ui/styles.css';

export default function AgentsHarnessPage(): ReactElement {
  useLayoutEffect(() => {
    setAcpHostBridge(createAcpUiHarnessBridge());
    seedAcpUiHarnessState({ sidebarOpen: false });

    return () => {
      resetAcpHostBridge();
    };
  }, []);

  return (
    <div className="copilot-acp-page">
      <div className="copilot-acp-host">
        <AcpUiApp />
      </div>
    </div>
  );
}
