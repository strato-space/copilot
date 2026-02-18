import React from "react";
import { Empty, Image, List, Space, Tag, Typography } from "antd";
import axios from "axios";
import { useAuthUser } from "../../store/AuthUser";

const { Text, Title } = Typography;

const formatTimestamp = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const dateMs = numeric > 1e11 ? numeric : numeric * 1000;
  return new Date(dateMs).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const toInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const isImageAttachment = (attachment) => {
  if (attachment?.mimeType && attachment.mimeType.startsWith("image/")) return true;
  const source = (attachment?.uri || attachment?.url || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(source);
};

const AttachmentPreview = ({ attachment }) => {
  const [isBroken, setIsBroken] = React.useState(false);
  const [resolvedSrc, setResolvedSrc] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const src = attachment?.uri || attachment?.url || null;
  const name = attachment?.name || "вложение";
  const mimeType = typeof attachment?.mimeType === "string" ? attachment.mimeType : "";
  const authToken = useAuthUser((state) => state.auth_token);

  const isMessageAttachmentProxy = React.useMemo(() => {
    if (!src) return false;
    try {
      const parsed = new URL(src, window.location.origin);
      return parsed.pathname.startsWith("/voicebot/message_attachment/");
    } catch (_) {
      return String(src).startsWith("/voicebot/message_attachment/");
    }
  }, [src]);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    setIsBroken(false);
    setIsLoading(false);
    setResolvedSrc(null);

    const run = async () => {
      if (!src || !isImageAttachment(attachment)) {
        return;
      }

      // Direct public URLs are publicly resolvable, no auth fetch needed.
      if (attachment?.direct_uri && !isMessageAttachmentProxy) {
        setResolvedSrc(src);
        return;
      }

      // For regular image URLs we can just pass src into <Image />.
      if (!isMessageAttachmentProxy) {
        setResolvedSrc(src);
        return;
      }

      // The attachment proxy is protected by X-Authorization header, which <img> cannot set.
      // Fetch the bytes with axios + auth header and render via blob URL.
      if (!authToken) {
        setIsBroken(true);
        return;
      }

      setIsLoading(true);
      try {
        const response = await axios.get(src, {
          responseType: "arraybuffer",
          withCredentials: true,
          headers: {
            "X-Authorization": authToken,
          },
        });

        if (cancelled) return;
        const blob = new Blob([response.data], {
          type: mimeType || "application/octet-stream",
        });
        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      } catch (_) {
        if (cancelled) return;
        setIsBroken(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [authToken, isMessageAttachmentProxy, attachment?.direct_uri, mimeType, src]);

  if (!src || !isImageAttachment(attachment) || isBroken) {
    return (
      <div className="flex items-center justify-center h-[220px] border border-dashed border-gray-300 rounded bg-gray-50 text-gray-500 text-sm">
        <Space direction="vertical" size={4} align="center">
          <span>Превью недоступно</span>
          <Text type="secondary" ellipsis={{ tooltip: name }}>
            {name}
          </Text>
        </Space>
      </div>
    );
  }

  if (isLoading || !resolvedSrc) {
    return (
      <div className="flex items-center justify-center h-[220px] border border-dashed border-gray-300 rounded bg-gray-50 text-gray-500 text-sm">
        <Space direction="vertical" size={4} align="center">
          <span>Загрузка превью...</span>
          <Text type="secondary" ellipsis={{ tooltip: name }}>
            {name}
          </Text>
        </Space>
      </div>
    );
  }

  return (
    <div className="h-[220px]">
      <Image
        src={resolvedSrc}
        alt={name}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onError={() => setIsBroken(true)}
        preview={{
          mask: "Просмотреть",
        }}
      />
    </div>
  );
};

const Screenshort = ({ attachments = [] }) => {
  const sortedAttachments = React.useMemo(() => {
    const safe = attachments.filter((item) => item && typeof item === "object");
    return [...safe].sort((a, b) => {
      const aTs = toInt(a.message_timestamp);
      const bTs = toInt(b.message_timestamp);
      if (aTs !== bTs) return (aTs ?? 0) - (bTs ?? 0);
      return `${a.message_id ?? ""}`.localeCompare(`${b.message_id ?? ""}`);
    });
  }, [attachments]);

  return (
    <div className="p-3">
      <List
        dataSource={sortedAttachments}
        locale={{
          emptyText: <Empty description="Скриншоты/вложения отсутствуют" />,
        }}
        grid={{ gutter: [12, 12], xs: 1, sm: 2, lg: 3, xl: 4 }}
        renderItem={(item) => (
          <List.Item>
            <div className="rounded border border-gray-200 bg-white h-full">
              <AttachmentPreview attachment={item} />
              <div className="p-2">
                <Title level={5} ellipsis={{ tooltip: item.caption || "Без подписи" }}>
                  {item.caption || "Без подписи"}
                </Title>
                <Space size={4} direction="vertical" className="w-full">
                  <Text type="secondary">
                    Сообщение: {item.message_id || "—"} · {formatTimestamp(item.message_timestamp) || "—"}
                  </Text>
                  <Text type="secondary" className="text-[12px]" ellipsis={{ tooltip: item.uri || item.url }}>
                    {item.uri || item.url || "Нет источника"}
                  </Text>
                  <Space wrap size={6}>
                    {item.kind && <Tag>{item.kind}</Tag>}
                    {item.source && <Tag>{item.source}</Tag>}
                    {typeof item.size === "number" && item.size > 0 && (
                      <Tag>{Math.max(1, Math.round(item.size / 1024))} KB</Tag>
                    )}
                  </Space>
                </Space>
              </div>
            </div>
          </List.Item>
        )}
      />
    </div>
  );
};

export default Screenshort;
