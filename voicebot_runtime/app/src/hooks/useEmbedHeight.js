import { useEffect, useMemo } from "react";

const parseOrigins = (value) =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

export default function useEmbedHeight({ enabled }) {
  const allowedOrigins = useMemo(
    () => parseOrigins(import.meta.env.VITE_EMBED_PARENT_ORIGINS),
    []
  );

  useEffect(() => {
    if (!enabled) return;

    const postHeight = () => {
      const height = document.documentElement?.scrollHeight ?? document.body?.scrollHeight ?? 0;
      const target = allowedOrigins.length > 0 ? allowedOrigins[0] : "*";
      window.parent?.postMessage({ type: "HEIGHT", value: height, version: 1 }, target);
    };

    const observer = new ResizeObserver(() => {
      postHeight();
    });

    observer.observe(document.documentElement);
    postHeight();

    return () => observer.disconnect();
  }, [allowedOrigins, enabled]);
}
