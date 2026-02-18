import React, { useState } from "react";
import { Modal, Button, Input, message } from "antd";

const { TextArea } = Input;

const CustomPromptModal = ({ visible, onCancel, onRun }) => {
    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);

    const handleRun = async () => {
        if (!prompt || prompt.trim() === "") {
            message.warning("Пожалуйста, введите промпт");
            return;
        }

        setLoading(true);
        try {
            await onRun(prompt);
        } catch (error) {
            console.error("Ошибка при выполнении промпта:", error);
            message.error("Ошибка при выполнении промпта");
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
                <Button
                    key="run"
                    type="primary"
                    loading={loading}
                    onClick={handleRun}
                >
                    Run
                </Button>
            ]}
        >
            <div style={{ marginBottom: 16 }}>
                <TextArea
                    placeholder="Введите промпт для обработки..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={15}
                    style={{ fontFamily: 'monospace', fontSize: 14 }}
                />
            </div>
        </Modal>
    );
};

export default CustomPromptModal;
