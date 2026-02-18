import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const parseOrigins = (value) =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const normalizePath = (path) => {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

export default function useEmbedBridge({ enabled, basePath = "/embed" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const lastSentPath = useRef(null);

  const allowedOrigins = useMemo(
    () => parseOrigins(import.meta.env.VITE_EMBED_PARENT_ORIGINS),
    []
  );

  const relativePath = useMemo(() => {
    if (!location.pathname.startsWith(basePath)) {
      return location.pathname;
    }
    const remainder = location.pathname.slice(basePath.length) || "/";
    return `${normalizePath(remainder)}${location.search}${location.hash}`;
  }, [location.pathname, location.search, location.hash, basePath]);

  useEffect(() => {
    if (!enabled) return;

    const handleMessage = (event) => {
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(event.origin)) {
        return;
      }

      const payload = event.data;
      if (!payload || typeof payload !== "object") return;

      if (payload.type === "NAVIGATE" && typeof payload.path === "string") {
        const nextPath = normalizePath(payload.path);
        const target = `${basePath}${nextPath}`;
        if (target !== location.pathname) {
          navigate(target, { replace: true });
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [allowedOrigins, basePath, enabled, location.pathname, navigate]);

  useEffect(() => {
    if (!enabled) return;
    if (lastSentPath.current === relativePath) return;
    lastSentPath.current = relativePath;
    const target = allowedOrigins.length > 0 ? allowedOrigins[0] : "*";
    window.parent?.postMessage({ type: "ROUTE_CHANGED", path: relativePath, version: 1 }, target);
  }, [allowedOrigins, enabled, relativePath]);
}
