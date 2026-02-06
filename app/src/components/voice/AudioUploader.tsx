import { useRef, useState } from 'react';
import { Upload, message } from 'antd';
import type { RcFile, UploadChangeParam, UploadFile } from 'antd/es/upload/interface';
import { InboxOutlined } from '@ant-design/icons';
import { useVoiceBotStore } from '../../store/voiceBotStore';

const { Dragger } = Upload;

interface AudioUploaderProps {
    sessionId: string | null;
    onUploadComplete?: (results: Array<Record<string, unknown>>) => void;
    disabled?: boolean;
}

const allowedTypes = [
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'video/webm',
    'audio/x-m4a',
];

export default function AudioUploader({ sessionId, onUploadComplete, disabled = false }: AudioUploaderProps) {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const processedKeysRef = useRef(new Set<string>());

    const uploadAudioFile = useVoiceBotStore((state) => state.uploadAudioFile);

    const validateFile = (file: RcFile): boolean => {
        const maxSize = 600 * 1024 * 1024;
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

    const fileKey = (file: RcFile): string => `${file.name}__${file.size}__${file.lastModified || 0}`;

    const handleFilesUpload = async (files: RcFile[]): Promise<void> => {
        if (!sessionId) {
            message.error('Не указан ID сессии');
            return;
        }

        const validFiles = files.filter((file) => validateFile(file));
        if (validFiles.length === 0) return;

        setUploading(true);
        setUploadProgress(0);

        const results: Array<Record<string, unknown>> = [];
        let successCount = 0;
        let failCount = 0;

        for (const [index, file] of validFiles.entries()) {
            try {
                const result = await uploadAudioFile(file as File, sessionId);
                results.push({ file, result, success: true });
                successCount += 1;
            } catch (error) {
                console.error('Upload failed:', error);
                results.push({ file, error, success: false });
                failCount += 1;
            } finally {
                const percent = Math.round(((index + 1) / validFiles.length) * 100);
                setUploadProgress(percent);
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
    };

    const handleChange = async (info: UploadChangeParam<UploadFile>): Promise<void> => {
        setFileList(info.fileList || []);
        const incoming = (info.fileList || [])
            .map((item) => item.originFileObj)
            .filter((file): file is RcFile => Boolean(file));

        const newFiles = incoming.filter((file) => !processedKeysRef.current.has(fileKey(file)));
        if (newFiles.length === 0) return;

        newFiles.forEach((file) => processedKeysRef.current.add(fileKey(file)));
        setFileList([]);

        if (!uploading) {
            await handleFilesUpload(newFiles);
        }
    };

    return (
        <div className="w-full">
            <Dragger
                multiple
                fileList={fileList}
                onChange={handleChange}
                beforeUpload={() => false}
                disabled={disabled || uploading}
                showUploadList={false}
            >
                <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                </p>
                <p className="ant-upload-text">Перетащите аудиофайл сюда или нажмите для выбора</p>
                <p className="ant-upload-hint">Поддерживаются MP3, WAV, OGG, WebM, M4a. Максимум 600MB.</p>
                {uploading && (
                    <p className="mt-2 text-sm text-slate-500">Загрузка: {uploadProgress}%</p>
                )}
            </Dragger>
        </div>
    );
}
