import { useRef, useState } from 'react';
import type { AxiosProgressEvent } from 'axios';
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

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const formatMb = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0.0';
    return (bytes / (1024 * 1024)).toFixed(1);
};

const describeUploadError = (error: unknown): string => {
    const err = error as {
        response?: { status?: number };
        code?: string;
        message?: string;
    };

    const status = typeof err?.response?.status === 'number' ? err.response.status : null;
    if (status === 413) {
        return 'Файл слишком большой для лимита сервера (413). Если файл < 600MB, нужно увеличить лимит на edge (Nginx).';
    }
    if (err?.code === 'ECONNABORTED') {
        return 'Таймаут загрузки. Повторите попытку и не закрывайте вкладку во время загрузки.';
    }
    if (typeof err?.message === 'string' && err.message.toLowerCase().includes('network')) {
        return 'Сетевая ошибка при загрузке. Проверьте соединение и попробуйте снова.';
    }
    return 'Ошибка загрузки файла.';
};


export default function AudioUploader({ sessionId, onUploadComplete, disabled = false }: AudioUploaderProps) {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadLoadedBytes, setUploadLoadedBytes] = useState(0);
    const [uploadTotalBytes, setUploadTotalBytes] = useState(0);
    const [uploadCurrentFileName, setUploadCurrentFileName] = useState<string | null>(null);
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

        const totalBytes = validFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
        let uploadedBytesBefore = 0;

        setUploading(true);
        setUploadProgress(0);
        setUploadLoadedBytes(0);
        setUploadTotalBytes(totalBytes);
        setUploadCurrentFileName(validFiles[0]?.name ?? null);

        const results: Array<Record<string, unknown>> = [];
        let successCount = 0;
        let failCount = 0;

        for (const file of validFiles) {
            setUploadCurrentFileName(file.name);

            const onUploadProgress = (evt: AxiosProgressEvent) => {
                const loadedCurrent = typeof evt.loaded === 'number' ? evt.loaded : 0;
                const overallLoaded = uploadedBytesBefore + loadedCurrent;

                setUploadLoadedBytes(overallLoaded);
                if (totalBytes > 0) {
                    setUploadProgress(clamp(Math.round((overallLoaded / totalBytes) * 100), 0, 100));
                }
            };

            try {
                const result = await uploadAudioFile(file as File, sessionId, { onUploadProgress });
                results.push({ file, result, success: true });
                successCount += 1;
                uploadedBytesBefore += Number(file.size || 0);

                setUploadLoadedBytes(uploadedBytesBefore);
                if (totalBytes > 0) {
                    setUploadProgress(clamp(Math.round((uploadedBytesBefore / totalBytes) * 100), 0, 100));
                }
            } catch (error) {
                console.error('Upload failed:', error);
                results.push({ file, error, success: false });
                failCount += 1;
                message.error(describeUploadError(error));
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

        setUploadCurrentFileName(null);
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
                    <p className="mt-2 text-sm text-slate-500">
                        {uploadCurrentFileName ? `${uploadCurrentFileName}: ` : ''}
                        {uploadTotalBytes > 0
                            ? `${formatMb(uploadLoadedBytes)} MB / ${formatMb(uploadTotalBytes)} MB (${uploadProgress}%)`
                            : `Загрузка: ${uploadProgress}%`}
                    </p>
                )}
            </Dragger>
        </div>
    );
}
