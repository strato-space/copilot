import React, { useState } from 'react';
import { Modal, Upload, Button, Input, Typography, message } from 'antd';
import { UploadOutlined, CloudUploadOutlined, FolderOutlined } from '@ant-design/icons';
import { useProjectFiles } from '../../store/project_files';

const { Text } = Typography;

const FileUploadModal = ({
    visible,
    onCancel,
    uploadTargetProject
}) => {
    const { uploadFileToProject } = useProjectFiles();
    const [uploadFolderPath, setUploadFolderPath] = useState('');
    const [uploading, setUploading] = useState(false);
    const [fileList, setFileList] = useState([]);

    const handleFileChange = ({ fileList: newFileList }) => {
        setFileList(newFileList);
    };

    const customRequest = ({ file, onSuccess, onError }) => {
        // Не делаем автоматическую загрузку, только добавляем в список
        setTimeout(() => {
            onSuccess("ok");
        }, 0);
    };

    const handleUploadFiles = async () => {
        if (!uploadTargetProject) {
            message.error('Выберите проект для загрузки');
            return;
        }

        if (fileList.length === 0) {
            message.error('Выберите файлы для загрузки');
            return;
        }

        setUploading(true);
        try {
            const files = fileList.map(f => f.originFileObj).filter(f => f);
            const uploadedFiles = await uploadFileToProject(
                uploadTargetProject._id,
                files,
                uploadFolderPath
            );

            message.success(`Успешно загружено ${uploadedFiles.length} файл(ов)`);
            // Сброс состояния после успешной загрузки
            setUploadFolderPath('');
            setFileList([]);
            onCancel(); // Закрыть модальное окно
        } catch (error) {
            message.error(`Ошибка загрузки: ${error.message}`);
        } finally {
            setUploading(false);
        }
    };

    const handleModalCancel = () => {
        setUploadFolderPath('');
        setFileList([]);
        onCancel();
    };
    return (
        <Modal
            title={
                <div className="flex items-center gap-2">
                    <UploadOutlined />
                    <span>Загрузка файлов в проект</span>
                </div>
            }
            open={visible}
            onCancel={handleModalCancel}
            footer={null}
            width={600}
            destroyOnClose={true}
        >
            {uploadTargetProject && (
                <div className="mb-4 p-4 bg-blue-50 rounded">
                    <Text strong>Проект: {uploadTargetProject.name}</Text>
                    <br />
                    <Text type="secondary">
                        Клиент: {uploadTargetProject.customer?.name || 'Не указан'}
                    </Text>
                </div>
            )}

            <div className="mb-4">
                <Text strong>Путь к папке (необязательно):</Text>
                <Input
                    placeholder="Например: documents/reports"
                    value={uploadFolderPath}
                    onChange={(e) => setUploadFolderPath(e.target.value)}
                    className="mt-2"
                    prefix={<FolderOutlined />}
                />
                <Text type="secondary" className="text-xs block mt-1">
                    Оставьте пустым для загрузки в корень папки проекта
                </Text>
            </div>

            <Upload.Dragger
                multiple={true}
                customRequest={customRequest}
                onChange={handleFileChange}
                fileList={fileList}
                showUploadList={true}
                disabled={uploading}
                className="mb-4"
            >
                <p className="ant-upload-drag-icon">
                    <CloudUploadOutlined className="text-4xl text-blue-400" />
                </p>
                <p className="ant-upload-text">
                    Нажмите или перетащите файлы для загрузки
                </p>
                <p className="ant-upload-hint">
                    Поддерживается загрузка нескольких файлов одновременно
                </p>
            </Upload.Dragger>

            <div className="flex justify-end">
                <Button
                    onClick={handleModalCancel}
                    className="mr-2"
                >
                    Отмена
                </Button>
                <Button
                    type="primary"
                    onClick={handleUploadFiles}
                    loading={uploading}
                    disabled={fileList.length === 0}
                    icon={<UploadOutlined />}
                >
                    Загрузить файлы
                </Button>
            </div>
        </Modal>
    );
};

export default FileUploadModal;
