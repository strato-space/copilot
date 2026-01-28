import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const DEFAULT_HEIGHT = 720;

const parseOrigins = (value?: string): string[] =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const normalizeBase = (base: string): string => (base.endsWith('/') ? base.slice(0, -1) : base);

const ensureLeadingSlash = (path: string): string => (path.startsWith('/') ? path : `/${path}`);

const buildRelativePath = (pathname: string, base: string): string => {
  if (!pathname.startsWith(base)) {
    return pathname;
  }

  const remainder = pathname.slice(base.length);
  if (!remainder) {
    return '/';
  }

  return ensureLeadingSlash(remainder);
};

type EmbedFrameProps = {
  baseUrl: string;
  routeBase: string;
  title: string;
  className?: string;
};

export default function EmbedFrame({ baseUrl, routeBase, title, className }: EmbedFrameProps): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const skipNavigateRef = useRef<string | null>(null);
  const [frameHeight, setFrameHeight] = useState<number>(DEFAULT_HEIGHT);

  const normalizedBaseUrl = useMemo(() => normalizeBase(baseUrl), [baseUrl]);
  const normalizedRouteBase = useMemo(() => normalizeBase(routeBase), [routeBase]);
  const allowedOrigins = useMemo(() => parseOrigins(import.meta.env.VITE_EMBED_ALLOWED_ORIGINS), []);
  const frameOrigin = useMemo((): string => {
    try {
      return new URL(normalizedBaseUrl).origin;
    } catch {
      return '';
    }
  }, [normalizedBaseUrl]);

  const relativePath = useMemo((): string => {
    const path = buildRelativePath(location.pathname, normalizedRouteBase);
    return `${path}${location.search}${location.hash}`;
  }, [location.pathname, location.search, location.hash, normalizedRouteBase]);

  const initialSrcRef = useRef<string | null>(null);
  if (!initialSrcRef.current) {
    initialSrcRef.current = `${normalizedBaseUrl}${relativePath}`;
  }

  const sendMessage = useCallback(
    (payload: Record<string, unknown>) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow) return;
      frameWindow.postMessage(payload, frameOrigin || '*');
    },
    [frameOrigin]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(event.origin)) {
        return;
      }

      if (!allowedOrigins.length && frameOrigin && event.origin !== frameOrigin) {
        return;
      }

      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const payload = event.data;
      if (!payload || typeof payload !== 'object') {
        return;
      }

      if ('type' in payload && payload.type === 'ROUTE_CHANGED' && typeof payload.path === 'string') {
        const nextPath = payload.path || '/';
        if (nextPath !== relativePath) {
          skipNavigateRef.current = nextPath;
          navigate(`${normalizedRouteBase}${ensureLeadingSlash(nextPath)}`);
        }
      }

      if ('type' in payload && payload.type === 'HEIGHT' && typeof payload.value === 'number') {
        const nextHeight = Math.max(0, Math.round(payload.value));
        if (nextHeight > 0) {
          setFrameHeight(nextHeight);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [allowedOrigins, frameOrigin, navigate, normalizedRouteBase, relativePath]);

  useEffect(() => {
    if (skipNavigateRef.current === relativePath) {
      skipNavigateRef.current = null;
      return;
    }

    sendMessage({ type: 'NAVIGATE', path: relativePath, version: 1 });
  }, [relativePath, sendMessage]);

  const handleLoad = useCallback(() => {
    sendMessage({ type: 'NAVIGATE', path: relativePath, version: 1 });
  }, [relativePath, sendMessage]);

  return (
    <div className={className}>
      <iframe
        ref={iframeRef}
        title={title}
        src={initialSrcRef.current ?? undefined}
        onLoad={handleLoad}
        className="w-full border-0"
        style={{ height: frameHeight }}
      />
    </div>
  );
}
