import React, { useState, useRef } from 'react';
import { Upload, Button, Progress, message } from 'antd';
import { InboxOutlined, AudioOutlined } from '@ant-design/icons';
import { useVoiceBot } from '../store/voiceBot';

const { Dragger } = Upload;

const AudioUploader = ({ sessionId, onUploadComplete, disabled = false }) => {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadLabel, setUploadLabel] = useState(null);
    const [fileList, setFileList] = useState([]);
    const fileInputRef = useRef(null);
    const processedKeysRef = useRef(new Set());
    const lastPercentRef = useRef(0);

    const uploadAudioFile = useVoiceBot(state => state.uploadAudioFile);

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const formatMb = (bytes) => `${(Number(bytes || 0) / (1024 * 1024)).toFixed(1)}MB`;

    const validateFile = (file) => {
        const allowedTypes = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'video/webm', 'audio/x-m4a'];
        const maxSize = 600 * 1024 * 1024; // 600MB
        console.log("File type: ", file.type);
        if (!allowedTypes.includes(file.type)) {
            message.error('Неподдерживаемый тип файла. Разрешены: MP3, MP4, WAV, OGG, WebM, M4a');
            return false;
        }

        if (file.size > maxSize) {
            message.error('Файл слишком большой. Максимальный размер: 600MB');
            return false;
        }

        return true;
    };

    const describeUploadError = (error) => {
        const status = error?.response?.status;
        if (status === 413) {
            return 'Файл слишком большой для лимита сервера (413). Если файл < 600MB, нужно увеличить лимит на edge (Nginx).';
        }
        if (error?.code === 'ECONNABORTED') {
            return 'Таймаут загрузки. Повторите попытку и не закрывайте вкладку во время загрузки.';
        }
        if (typeof error?.message === 'string' && error.message.toLowerCase().includes('network')) {
            return 'Сетевая ошибка при загрузке. Проверьте соединение и попробуйте снова.';
        }
        return 'Ошибка загрузки файла.';
    };

    const handleFilesUpload = async (files) => {
        if (!sessionId) {
            message.error('Не указан ID сессии');
            return;
        }

        const validFiles = files.filter(f => validateFile(f));
        if (validFiles.length === 0) {
            return;
        }

        setUploading(true);
        setUploadProgress(0);
        setUploadLabel(null);
        lastPercentRef.current = 0;

        const results = [];
        let successCount = 0;
        let failCount = 0;

        const totalBytes = validFiles.reduce((sum, f) => sum + Number(f?.size || 0), 0);
        let uploadedBytesBefore = 0;

        for (let i = 0; i < validFiles.length; i++) {
            const file = validFiles[i];
            try {
                const onUploadProgress = (evt) => {
                    const loadedCurrent = Number(evt?.loaded || 0);
                    const totalCurrent = Number(evt?.total || file?.size || 0);
                    const overallLoaded = uploadedBytesBefore + loadedCurrent;
                    const percent = totalBytes > 0
                        ? clamp(Math.round((overallLoaded / totalBytes) * 100), 0, 100)
                        : 0;

                    if (percent !== lastPercentRef.current) {
                        lastPercentRef.current = percent;
                        setUploadProgress(percent);
                    }
                    setUploadLabel({
                        fileName: file?.name || 'audio',
                        loaded: overallLoaded,
                        total: totalBytes,
                        fileLoaded: loadedCurrent,
                        fileTotal: totalCurrent
                    });
                };

                const result = await uploadAudioFile(file, sessionId, { silent: true, onUploadProgress });
                results.push({ file, result, success: true });
                successCount += 1;
            } catch (error) {
                console.error('Upload failed:', error);
                results.push({ file, error, success: false });
                failCount += 1;
                message.error(describeUploadError(error));
            } finally {
                uploadedBytesBefore += Number(file?.size || 0);
                if (totalBytes > 0) {
                    const percent = clamp(Math.round((uploadedBytesBefore / totalBytes) * 100), 0, 100);
                    if (percent !== lastPercentRef.current) {
                        lastPercentRef.current = percent;
                        setUploadProgress(percent);
                    }
                }
            }
        }

        if (successCount > 0 && failCount === 0) {
            message.success(`Загружено файлов: ${successCount}`);
        } else if (successCount > 0 && failCount > 0) {
            message.warning(`Успешно: ${successCount}, Ошибки: ${failCount}`);
        } else {
            message.error('Не удалось загрузить файлы');
        }

        if (onUploadComplete) {
            onUploadComplete(results);
        }

        setUploading(false);
        setUploadLabel(null);
    };

    const fileKey = (f) => `${f.name}__${f.size}__${f.lastModified || 0}`;

    const handleChange = async (info) => {
        setFileList(info.fileList || []);
        // Extract original File objects from the antd Upload fileList
        const incoming = (info?.fileList || [])
            .map(item => item.originFileObj)
            .filter(Boolean);
        // Filter only new files not processed yet
        const newFiles = incoming.filter(f => !processedKeysRef.current.has(fileKey(f)));
        if (newFiles.length === 0) return;
        // Mark as processed before starting to avoid duplicate handling on rapid multiple onChange events
        newFiles.forEach(f => processedKeysRef.current.add(fileKey(f)));
        // Clear visual list to prevent repeated onChange cascades
        setFileList([]);
        if (!uploading) {
            await handleFilesUpload(newFiles);
        }
    };

    return (
        <div style={{ width: '100%' }}>
            <Dragger
                name="audio"
                multiple
                accept="audio/*"
                beforeUpload={() => false}
                onChange={handleChange}
                disabled={disabled || uploading}
                showUploadList={false}
                fileList={fileList}
            >
                <p className="ant-upload-drag-icon">
                    <AudioOutlined style={{ fontSize: '48px' }} />
                </p>
                <p className="ant-upload-text">
                    Нажмите или перетащите аудио файл для загрузки
                </p>
                <p className="ant-upload-hint">
                    Можно выбрать и загрузить несколько аудио-файлов. Форматы: MP3, MP4, WAV, OGG, WebM, M4A. Максимальный размер: 600MB на файл.
                </p>
            </Dragger>

            {uploading && (
                <div style={{ marginTop: 16 }}>
                    <Progress percent={uploadProgress} status="active" />
                    <div style={{ textAlign: 'center', marginTop: 8 }}>
                        {uploadLabel
                            ? (
                                <div>
                                    <div style={{ fontWeight: 600 }}>{uploadLabel.fileName}</div>
                                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                                        {formatMb(uploadLabel.loaded)} / {formatMb(uploadLabel.total)}
                                    </div>
                                </div>
                            )
                            : 'Загрузка файла...'}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AudioUploader;
