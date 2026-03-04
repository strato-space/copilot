import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Alert, Button, Input, Typography } from 'antd';

type SummarySaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

interface CategorizationTableSummaryProps {
    sessionId?: string | undefined;
    summaryText?: string | undefined;
    summarySavedAt?: string | undefined;
    onSave: (payload: { session_id: string; md_text: string }) => Promise<{ md_text: string; updated_at: string }>;
}

const formatSummarySavedAt = (value?: string): string => {
    if (!value) return 'Не сохранено';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Не сохранено';
    return date.toLocaleString('ru-RU');
};

export default function CategorizationTableSummary({
    sessionId,
    summaryText,
    summarySavedAt,
    onSave,
}: CategorizationTableSummaryProps): ReactElement {
    const canonicalText = typeof summaryText === 'string' ? summaryText : '';
    const canonicalSavedAt = typeof summarySavedAt === 'string' ? summarySavedAt : '';

    const [draftText, setDraftText] = useState<string>(canonicalText);
    const [baseText, setBaseText] = useState<string>(canonicalText);
    const [baseSavedAt, setBaseSavedAt] = useState<string>(canonicalSavedAt);
    const [isEditing, setIsEditing] = useState<boolean>(canonicalText.length === 0);
    const [saveState, setSaveState] = useState<SummarySaveState>('idle');
    const [statusText, setStatusText] = useState<string>('');

    const hasConcurrentSummaryUpdate = canonicalText !== baseText || canonicalSavedAt !== baseSavedAt;
    const isDirty = draftText !== baseText;
    const canSave = Boolean(sessionId) && isEditing && isDirty && saveState !== 'saving';

    useEffect(() => {
        if (!isEditing || !isDirty) {
            setDraftText(canonicalText);
            setBaseText(canonicalText);
            setBaseSavedAt(canonicalSavedAt);
            if (saveState === 'conflict' || saveState === 'error') {
                setSaveState('idle');
                setStatusText('');
            }
            return;
        }

        if (hasConcurrentSummaryUpdate && saveState !== 'saving') {
            setSaveState('conflict');
            setStatusText('Сводка изменилась в другой вкладке. Обновите текст перед сохранением.');
        }
    }, [canonicalText, canonicalSavedAt, isEditing, isDirty, hasConcurrentSummaryUpdate, saveState]);

    const savedAtLabel = useMemo(() => formatSummarySavedAt(canonicalSavedAt), [canonicalSavedAt]);

    const handleStartEditing = (): void => {
        setIsEditing(true);
        setSaveState('idle');
        setStatusText('');
        setBaseText(canonicalText);
        setBaseSavedAt(canonicalSavedAt);
        setDraftText(canonicalText);
    };

    const handleCancel = (): void => {
        setIsEditing(false);
        setDraftText(canonicalText);
        setBaseText(canonicalText);
        setBaseSavedAt(canonicalSavedAt);
        setSaveState('idle');
        setStatusText('');
    };

    const handleSave = async (): Promise<void> => {
        if (!sessionId || saveState === 'saving') return;

        if (hasConcurrentSummaryUpdate && draftText !== canonicalText) {
            setSaveState('conflict');
            setStatusText('Сводка изменилась в другой вкладке. Синхронизируйте текст и повторите сохранение.');
            return;
        }

        setSaveState('saving');
        setStatusText('');

        try {
            const response = await onSave({
                session_id: sessionId,
                md_text: draftText,
            });
            const persistedText = typeof response?.md_text === 'string' ? response.md_text : draftText;
            const persistedSavedAt = typeof response?.updated_at === 'string'
                ? response.updated_at
                : new Date().toISOString();
            setDraftText(persistedText);
            setBaseText(persistedText);
            setBaseSavedAt(persistedSavedAt);
            setIsEditing(false);
            setSaveState('saved');
            setStatusText('Сводка сохранена');
        } catch (error) {
            const errorText = error instanceof Error ? error.message : 'Не удалось сохранить сводку';
            setSaveState('error');
            setStatusText(errorText);
        }
    };

    return (
        <section className="mt-3 rounded border border-slate-200 bg-slate-50/50 p-3" data-testid="categorization-summary-panel">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Typography.Title level={5} className="!m-0">
                    Summary
                </Typography.Title>
                <Typography.Text type="secondary" className="text-xs">
                    Обновлено: {savedAtLabel}
                </Typography.Text>
            </div>

            <Input.TextArea
                value={draftText}
                onChange={(event) => {
                    setDraftText(event.target.value);
                    if (saveState !== 'saving') {
                        setSaveState('idle');
                        setStatusText('');
                    }
                }}
                autoSize={{ minRows: 4, maxRows: 12 }}
                maxLength={20000}
                placeholder="Добавьте markdown summary..."
                disabled={!isEditing || saveState === 'saving'}
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
                {isEditing ? (
                    <>
                        <Button type="primary" onClick={handleSave} loading={saveState === 'saving'} disabled={!canSave}>
                            Сохранить
                        </Button>
                        <Button onClick={handleCancel} disabled={saveState === 'saving'}>
                            Отменить
                        </Button>
                    </>
                ) : (
                    <Button onClick={handleStartEditing}>Редактировать</Button>
                )}
            </div>

            {saveState === 'saved' && statusText ? (
                <Typography.Text className="mt-2 block text-xs text-emerald-600">{statusText}</Typography.Text>
            ) : null}

            {(saveState === 'error' || saveState === 'conflict') && statusText ? (
                <Alert
                    className="mt-2"
                    type={saveState === 'conflict' ? 'warning' : 'error'}
                    message={statusText}
                    showIcon
                />
            ) : null}
        </section>
    );
}
