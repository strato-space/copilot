import { useState } from 'react';
import { Button, Input, message, Modal } from 'antd';

const { TextArea } = Input;

interface CustomPromptModalProps {
    visible: boolean;
    onCancel: () => void;
    onRun: (prompt: string) => Promise<void>;
}

export default function CustomPromptModal({ visible, onCancel, onRun }: CustomPromptModalProps) {
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);

    const handleRun = async (): Promise<void> => {
        if (!prompt || prompt.trim() === '') {
            message.warning('Пожалуйста, введите промпт');
            return;
        }

        setLoading(true);
        try {
            await onRun(prompt);
        } catch (error) {
            console.error('Ошибка при выполнении промпта:', error);
            message.error('Ошибка при выполнении промпта');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            title="Запуск произвольного промпта"
            open={visible}
            onCancel={onCancel}
            width={800}
            footer={[
                <Button key="cancel" onClick={onCancel} disabled={loading}>
                    Cancel
                </Button>,
                <Button key="run" type="primary" loading={loading} onClick={handleRun}>
                    Run
                </Button>,
            ]}
        >
            <div className="mb-4">
                <TextArea
                    placeholder="Введите промпт для обработки..."
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={15}
                    className="font-mono text-sm"
                />
            </div>
        </Modal>
    );
}
