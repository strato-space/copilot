import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Button, Input, List, Modal, Select, Space, Tag, Typography, message as messageApi } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import type { VoiceBotMessage } from '../../types/voice';

const { Text } = Typography;
const { TextArea } = Input;

type SegmentView = {
    id: string;
    text: string;
    is_deleted: boolean;
};

const formatEventTime = (value: unknown): string => {
    if (!value) return '';
    try {
        return dayjs(value as string | number | Date).format('YYYY-MM-DD HH:mm:ss');
    } catch {
        return String(value);
    }
};

const getSegmentsFromMessage = (message: VoiceBotMessage | null): SegmentView[] => {
    if (!message) return [];
    const record = message as unknown as Record<string, unknown>;

    const transcription = record.transcription as { segments?: Array<Record<string, unknown>> } | undefined;
    if (Array.isArray(transcription?.segments) && transcription.segments.length > 0) {
        return transcription.segments
            .map((segment) => ({
                id: String(segment.id || ''),
                text: typeof segment.text === 'string' ? segment.text : '',
                is_deleted: Boolean(segment.is_deleted),
            }))
            .filter((segment) => segment.id.length > 0);
    }

    const legacySegments = record.transcription_chunks;
    if (!Array.isArray(legacySegments)) return [];

    return legacySegments
        .map((chunk) => {
            if (!chunk || typeof chunk !== 'object') return null;
            const segment = chunk as Record<string, unknown>;
            const id = typeof segment.id === 'string' ? segment.id : '';
            if (!id) return null;
            return {
                id,
                text: typeof segment.text === 'string' ? segment.text : '',
                is_deleted: Boolean(segment.is_deleted),
            };
        })
        .filter((segment): segment is SegmentView => segment !== null);
};

export default function SessionLog() {
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
    } = useVoiceBotStore();

    const [actionModal, setActionModal] = useState<{ type: 'rollback' | 'resend' | 'retry'; event: Record<string, unknown> } | null>(null);
    const [reason, setReason] = useState('');

    const [segmentModalOpen, setSegmentModalOpen] = useState(false);
    const [segmentMode, setSegmentMode] = useState<'edit' | 'delete'>('edit');
    const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
    const [selectedSegmentOid, setSelectedSegmentOid] = useState<string | null>(null);
    const [segmentText, setSegmentText] = useState('');
    const [segmentReason, setSegmentReason] = useState('');

    const refresh = async (): Promise<void> => {
        if (!voiceBotSession?._id) return;
        await fetchSessionLog(voiceBotSession._id, { silent: true });
    };

    useEffect(() => {
        if (!voiceBotSession?._id) return;
        void refresh();
    }, [voiceBotSession?._id]);

    const closeActionModal = (): void => {
        setActionModal(null);
        setReason('');
    };

    const openActionModal = (type: 'rollback' | 'resend' | 'retry', event: Record<string, unknown>): void => {
        setActionModal({ type, event });
        setReason('');
    };

    const runEventAction = async (): Promise<void> => {
        if (!actionModal || !voiceBotSession?._id) return;
        const eventOid = typeof actionModal.event.oid === 'string' ? actionModal.event.oid : '';
        if (!eventOid) return;

        const payloadBase = {
            session_id: voiceBotSession._id,
            event_oid: eventOid,
        };
        const payload = reason.trim() ? { ...payloadBase, reason: reason.trim() } : payloadBase;

        try {
            if (actionModal.type === 'rollback') {
                await rollbackSessionEvent(payload, { silent: true });
            } else if (actionModal.type === 'resend') {
                await resendNotifyEvent(payload, { silent: true });
            } else {
                await retryCategorizationEvent(payload, { silent: true });
            }
            await fetchVoiceBotSession(voiceBotSession._id);
            await refresh();
            closeActionModal();
            messageApi.success('Done');
        } catch (error) {
            console.error(error);
            messageApi.error('Failed');
        }
    };

    const resetSegmentModal = (): void => {
        setSelectedMessageId(null);
        setSelectedSegmentOid(null);
        setSegmentText('');
        setSegmentReason('');
    };

    const openSegmentModal = (mode: 'edit' | 'delete'): void => {
        setSegmentMode(mode);
        setSegmentModalOpen(true);
        resetSegmentModal();
    };

    const closeSegmentModal = (): void => {
        setSegmentModalOpen(false);
        resetSegmentModal();
    };

    const selectedMessage = useMemo(
        () => (voiceBotMessages || []).find((message) => message?._id === selectedMessageId) || null,
        [voiceBotMessages, selectedMessageId]
    );

    const availableSegments = useMemo(
        () => getSegmentsFromMessage(selectedMessage).filter((segment) => !segment.is_deleted),
        [selectedMessage]
    );

    const runSegmentAction = async (): Promise<void> => {
        if (!voiceBotSession?._id) return;
        if (!selectedMessageId || !selectedSegmentOid) {
            messageApi.error('Select message and segment');
            return;
        }

        try {
            if (segmentMode === 'edit') {
                if (!segmentText.trim()) {
                    messageApi.error('New text is required');
                    return;
                }
                const editPayloadBase = {
                    session_id: voiceBotSession._id,
                    message_id: selectedMessageId,
                    segment_oid: selectedSegmentOid,
                    new_text: segmentText,
                };
                const editPayload = segmentReason.trim()
                    ? { ...editPayloadBase, reason: segmentReason.trim() }
                    : editPayloadBase;
                await editTranscriptChunk(editPayload, { silent: true });
            } else {
                const deletePayloadBase = {
                    session_id: voiceBotSession._id,
                    message_id: selectedMessageId,
                    segment_oid: selectedSegmentOid,
                };
                const deletePayload = segmentReason.trim()
                    ? { ...deletePayloadBase, reason: segmentReason.trim() }
                    : deletePayloadBase;
                await deleteTranscriptChunk(deletePayload, { silent: true });
            }

            await fetchVoiceBotSession(voiceBotSession._id);
            await refresh();
            closeSegmentModal();
            messageApi.success('Done');
        } catch (error) {
            console.error(error);
            messageApi.error('Failed');
        }
    };

    return (
        <div className="p-3">
            <div className="mb-3 flex items-center justify-between">
                <Space>
                    <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
                        Refresh
                    </Button>
                    <Button onClick={() => openSegmentModal('edit')}>Edit segment</Button>
                    <Button danger onClick={() => openSegmentModal('delete')}>
                        Delete segment
                    </Button>
                </Space>
            </div>

            <List
                bordered
                dataSource={sessionLogEvents || []}
                locale={{ emptyText: 'No events' }}
                renderItem={(item) => {
                    const eventRecord = item as unknown as Record<string, unknown>;
                    const action = (eventRecord.action || null) as { available?: boolean; type?: string } | null;
                    const canRollback = action?.available && action.type === 'rollback';
                    const canResend = action?.available && action.type === 'resend';
                    const canRetry = action?.available && action.type === 'retry';

                    return (
                        <List.Item
                            actions={[
                                canRollback ? (
                                    <Button key="rollback" onClick={() => openActionModal('rollback', eventRecord)}>
                                        Rollback
                                    </Button>
                                ) : null,
                                canResend ? (
                                    <Button key="resend" onClick={() => openActionModal('resend', eventRecord)}>
                                        Resend
                                    </Button>
                                ) : null,
                                canRetry ? (
                                    <Button key="retry" onClick={() => openActionModal('retry', eventRecord)}>
                                        Retry
                                    </Button>
                                ) : null,
                            ].filter((control): control is NonNullable<typeof control> => control !== null)}
                        >
                            <div className="w-full">
                                <div className="flex items-center justify-between gap-2">
                                    <Space wrap>
                                        <Tag color="blue">{typeof eventRecord.event_group === 'string' ? eventRecord.event_group : 'system'}</Tag>
                                        <Text strong>{typeof eventRecord.event_name === 'string' ? eventRecord.event_name : 'unknown'}</Text>
                                        {typeof eventRecord.status === 'string' ? <Tag>{eventRecord.status}</Tag> : null}
                                    </Space>
                                    <Text type="secondary">{formatEventTime(eventRecord.event_time)}</Text>
                                </div>
                                <div className="mt-1 text-xs text-black/70">
                                    {eventRecord.target && typeof eventRecord.target === 'object' && (eventRecord.target as { entity_oid?: string }).entity_oid ? (
                                        <div>
                                            <Text type="secondary">target:</Text> {(eventRecord.target as { entity_oid?: string }).entity_oid}
                                        </div>
                                    ) : null}
                                    {typeof eventRecord.reason === 'string' && eventRecord.reason.length > 0 ? (
                                        <div>
                                            <Text type="secondary">reason:</Text> {eventRecord.reason}
                                        </div>
                                    ) : null}
                                    {eventRecord.diff && typeof eventRecord.diff === 'object' ? (
                                        <div className="mt-1">
                                            <Text type="secondary">diff:</Text>{' '}
                                            <span className="font-mono">
                                                {JSON.stringify((eventRecord.diff as { old_value?: unknown }).old_value)}
                                            </span>{' '}
                                            {'->'}{' '}
                                            <span className="font-mono">
                                                {JSON.stringify((eventRecord.diff as { new_value?: unknown }).new_value)}
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
                title={`${actionModal?.type || ''} (${typeof actionModal?.event?.event_name === 'string' ? actionModal.event.event_name : ''})`}
                open={Boolean(actionModal)}
                okText="Run"
                onOk={() => void runEventAction()}
                onCancel={closeActionModal}
            >
                <TextArea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    placeholder="Reason (optional)"
                />
            </Modal>

            <Modal
                title={segmentMode === 'edit' ? 'Edit transcript segment' : 'Delete transcript segment'}
                open={segmentModalOpen}
                okText={segmentMode === 'edit' ? 'Edit' : 'Delete'}
                {...(segmentMode === 'delete' ? { okButtonProps: { danger: true } } : {})}
                onOk={() => void runSegmentAction()}
                onCancel={closeSegmentModal}
            >
                <div className="mb-3">
                    <Text type="secondary">Message</Text>
                    <Select
                        className="mt-1 w-full"
                        value={selectedMessageId}
                        onChange={(value: string) => {
                            setSelectedMessageId(value);
                            setSelectedSegmentOid(null);
                            setSegmentText('');
                        }}
                        placeholder="Select message"
                        options={(voiceBotMessages || [])
                            .filter((message) => typeof message?._id === 'string')
                            .map((message) => ({
                                value: String(message._id),
                                label: `${message._id} (${message.message_id ?? 'n/a'})`,
                            }))}
                    />
                </div>

                <div className="mb-3">
                    <Text type="secondary">Segment</Text>
                    <Select
                        className="mt-1 w-full"
                        value={selectedSegmentOid}
                        onChange={(value: string) => {
                            setSelectedSegmentOid(value);
                            const segment = availableSegments.find((item) => item.id === value);
                            setSegmentText(segment?.text || '');
                        }}
                        placeholder="Select segment"
                        disabled={!selectedMessageId}
                        options={availableSegments.map((segment) => ({
                            value: segment.id,
                            label: `${segment.id}: ${(segment.text || '').slice(0, 60)}`,
                        }))}
                    />
                </div>

                {segmentMode === 'edit' ? (
                    <div className="mb-3">
                        <Text type="secondary">New text</Text>
                        <TextArea
                            className="mt-1"
                            value={segmentText}
                            onChange={(event) => setSegmentText(event.target.value)}
                            rows={4}
                            placeholder="New segment text"
                        />
                    </div>
                ) : null}

                <div>
                    <Text type="secondary">Reason (optional)</Text>
                    <Input className="mt-1" value={segmentReason} onChange={(event) => setSegmentReason(event.target.value)} />
                </div>
            </Modal>
        </div>
    );
}
