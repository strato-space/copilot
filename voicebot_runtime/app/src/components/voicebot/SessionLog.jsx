import React from "react";
import dayjs from "dayjs";
import { Button, Input, List, Modal, Select, Space, Tag, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useVoiceBot } from "../../store/voiceBot";

const { Text } = Typography;
const { TextArea } = Input;

const formatEventTime = (value) => {
  if (!value) return "";
  try {
    return dayjs(value).format("YYYY-MM-DD HH:mm:ss");
  } catch (e) {
    return String(value);
  }
};

const getSegmentsFromMessage = (msg) => {
  if (!msg) return [];
  const transcriptionSegments = msg?.transcription?.segments;
  if (Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0) {
    return transcriptionSegments;
  }
  const legacy = msg?.transcription_chunks;
  if (Array.isArray(legacy) && legacy.length > 0) {
    return legacy
      .map((chunk) => ({
        id: chunk?.id,
        start: null,
        end: null,
        speaker: chunk?.speaker || null,
        text: chunk?.text || "",
        is_deleted: Boolean(chunk?.is_deleted),
      }))
      .filter((seg) => typeof seg.id === "string" && seg.id.startsWith("ch_"));
  }
  return [];
};

const SessionLog = () => {
  const {
    voiceBotSession,
    voiceBotMessages,
    sessionLogEvents,
    fetchSessionLog,
    fetchVoiceBotSession,
    editTranscriptChunk,
    deleteTranscriptChunk,
    rollbackSessionEvent,
    resendNotifyEvent,
    retryCategorizationEvent,
  } = useVoiceBot();

  const [actionModal, setActionModal] = React.useState(null);
  const [reason, setReason] = React.useState("");

  const [segmentModalOpen, setSegmentModalOpen] = React.useState(false);
  const [segmentMode, setSegmentMode] = React.useState("edit");
  const [selectedMessageId, setSelectedMessageId] = React.useState(null);
  const [selectedSegmentOid, setSelectedSegmentOid] = React.useState(null);
  const [segmentText, setSegmentText] = React.useState("");
  const [segmentReason, setSegmentReason] = React.useState("");

  const refresh = async () => {
    if (!voiceBotSession?._id) return;
    await fetchSessionLog(voiceBotSession._id, { silent: true });
  };

  React.useEffect(() => {
    if (voiceBotSession?._id) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceBotSession?._id]);

  const closeActionModal = () => {
    setActionModal(null);
    setReason("");
  };

  const openActionModal = (type, event) => {
    setActionModal({ type, event });
    setReason("");
  };

  const runEventAction = async () => {
    if (!actionModal?.event?.oid || !voiceBotSession?._id) return;
    const event_oid = actionModal.event.oid;
    const session_id = voiceBotSession._id;

    try {
      if (actionModal.type === "rollback") {
        await rollbackSessionEvent({ session_id, event_oid, reason }, { silent: true });
      } else if (actionModal.type === "resend") {
        await resendNotifyEvent({ session_id, event_oid, reason }, { silent: true });
      } else if (actionModal.type === "retry") {
        await retryCategorizationEvent({ session_id, event_oid, reason }, { silent: true });
      }

      await fetchVoiceBotSession(session_id);
      await refresh();
      closeActionModal();
      message.success("Done");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      message.error("Failed");
    }
  };

  const resetSegmentModal = () => {
    setSelectedMessageId(null);
    setSelectedSegmentOid(null);
    setSegmentText("");
    setSegmentReason("");
  };

  const openSegmentModal = (mode) => {
    setSegmentMode(mode);
    setSegmentModalOpen(true);
    resetSegmentModal();
  };

  const closeSegmentModal = () => {
    setSegmentModalOpen(false);
    resetSegmentModal();
  };

  const selectedMessage = (voiceBotMessages || []).find((m) => m?._id === selectedMessageId) || null;
  const availableSegments = getSegmentsFromMessage(selectedMessage).filter((s) => !s?.is_deleted);

  const runSegmentAction = async () => {
    if (!voiceBotSession?._id) return;
    if (!selectedMessageId || !selectedSegmentOid) {
      message.error("Select message and segment");
      return;
    }

    try {
      if (segmentMode === "edit") {
        if (!segmentText.trim()) {
          message.error("New text is required");
          return;
        }
        await editTranscriptChunk(
          {
            session_id: voiceBotSession._id,
            message_id: selectedMessageId,
            segment_oid: selectedSegmentOid,
            new_text: segmentText,
            reason: segmentReason.trim() ? segmentReason : undefined,
          },
          { silent: true }
        );
      } else {
        await deleteTranscriptChunk(
          {
            session_id: voiceBotSession._id,
            message_id: selectedMessageId,
            segment_oid: selectedSegmentOid,
            reason: segmentReason.trim() ? segmentReason : undefined,
          },
          { silent: true }
        );
      }

      await fetchVoiceBotSession(voiceBotSession._id);
      await refresh();
      closeSegmentModal();
      message.success("Done");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      message.error("Failed");
    }
  };

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={() => openSegmentModal("edit")}>Edit segment</Button>
          <Button danger onClick={() => openSegmentModal("delete")}>
            Delete segment
          </Button>
        </Space>
      </div>

      <List
        bordered
        dataSource={sessionLogEvents || []}
        locale={{ emptyText: "No events" }}
        renderItem={(item) => {
          const action = item?.action;
          const canRollback = action?.available && action?.type === "rollback";
          const canResend = action?.available && action?.type === "resend";
          const canRetry = action?.available && action?.type === "retry";

          return (
            <List.Item
              actions={[
                canRollback ? (
                  <Button key="rollback" onClick={() => openActionModal("rollback", item)}>
                    Rollback
                  </Button>
                ) : null,
                canResend ? (
                  <Button key="resend" onClick={() => openActionModal("resend", item)}>
                    Resend
                  </Button>
                ) : null,
                canRetry ? (
                  <Button key="retry" onClick={() => openActionModal("retry", item)}>
                    Retry
                  </Button>
                ) : null,
              ].filter(Boolean)}
            >
              <div className="w-full">
                <div className="flex items-center justify-between gap-2">
                  <Space wrap>
                    <Tag color="blue">{item?.event_group || "system"}</Tag>
                    <Text strong>{item?.event_name}</Text>
                    {item?.status ? <Tag>{item.status}</Tag> : null}
                  </Space>
                  <Text type="secondary">{formatEventTime(item?.event_time)}</Text>
                </div>
                <div className="mt-1 text-xs text-black/70">
                  {item?.target?.entity_oid ? (
                    <div>
                      <Text type="secondary">target:</Text> {item.target.entity_oid}
                    </div>
                  ) : null}
                  {item?.reason ? (
                    <div>
                      <Text type="secondary">reason:</Text> {item.reason}
                    </div>
                  ) : null}
                  {item?.diff?.old_value !== undefined || item?.diff?.new_value !== undefined ? (
                    <div className="mt-1">
                      <Text type="secondary">diff:</Text>{" "}
                      <span className="font-mono">
                        {typeof item?.diff?.old_value === "string" ? item.diff.old_value : JSON.stringify(item?.diff?.old_value)}
                      </span>{" "}
                      {"->"}{" "}
                      <span className="font-mono">
                        {typeof item?.diff?.new_value === "string" ? item.diff.new_value : JSON.stringify(item?.diff?.new_value)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </List.Item>
          );
        }}
      />

      <Modal
        title={`${actionModal?.type || ""} (${actionModal?.event?.event_name || ""})`}
        open={Boolean(actionModal)}
        okText="Run"
        onOk={runEventAction}
        onCancel={closeActionModal}
      >
        <TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason (optional)"
        />
      </Modal>

      <Modal
        title={segmentMode === "edit" ? "Edit transcript segment" : "Delete transcript segment"}
        open={segmentModalOpen}
        okText={segmentMode === "edit" ? "Edit" : "Delete"}
        okButtonProps={segmentMode === "delete" ? { danger: true } : undefined}
        onOk={runSegmentAction}
        onCancel={closeSegmentModal}
      >
        <div className="mb-3">
          <Text type="secondary">Message</Text>
          <Select
            className="w-full mt-1"
            value={selectedMessageId}
            onChange={(v) => {
              setSelectedMessageId(v);
              setSelectedSegmentOid(null);
              setSegmentText("");
            }}
            placeholder="Select message"
            options={(voiceBotMessages || []).map((m) => ({
              value: m._id,
              label: `${m._id} (${m.message_id ?? "n/a"})`,
            }))}
          />
        </div>

        <div className="mb-3">
          <Text type="secondary">Segment</Text>
          <Select
            className="w-full mt-1"
            value={selectedSegmentOid}
            onChange={(v) => {
              setSelectedSegmentOid(v);
              const seg = availableSegments.find((s) => s.id === v);
              setSegmentText(seg?.text || "");
            }}
            placeholder="Select segment"
            disabled={!selectedMessageId}
            options={availableSegments.map((s) => ({
              value: s.id,
              label: `${s.id}: ${(s.text || "").slice(0, 60)}`,
            }))}
          />
        </div>

        {segmentMode === "edit" ? (
          <div className="mb-3">
            <Text type="secondary">New text</Text>
            <TextArea
              className="mt-1"
              value={segmentText}
              onChange={(e) => setSegmentText(e.target.value)}
              rows={4}
              placeholder="New segment text"
            />
          </div>
        ) : null}

        <div>
            <Text type="secondary">Reason (optional)</Text>
          <Input className="mt-1" value={segmentReason} onChange={(e) => setSegmentReason(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
};

export default SessionLog;
