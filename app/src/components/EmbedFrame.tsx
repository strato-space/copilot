/**
 * EmbedFrame - Wrapper for embedding external URLs in an iframe
 */

import { type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';

interface EmbedFrameProps {
    baseUrl: string;
    routeBase: string;
    title: string;
    className?: string;
}

export default function EmbedFrame({
    baseUrl,
    routeBase,
    title,
    className = '',
}: EmbedFrameProps): ReactElement {
    const location = useLocation();

    // Build the iframe URL by appending the path after routeBase
    const path = location.pathname.replace(routeBase, '') || '/';
    const iframeUrl = `${baseUrl}${path}${location.search}`;

    return (
        <div className={`embed-frame ${className}`} style={{ height: 'calc(100vh - 120px)' }}>
            <iframe
                src={iframeUrl}
                title={title}
                style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    borderRadius: '8px',
                }}
            />
        </div>
    );
}
