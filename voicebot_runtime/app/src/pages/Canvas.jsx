import React, { useEffect, useState } from 'react';
import { Alert } from 'antd';
import { useProjectFiles } from '../store/project_files';
import { useRequest } from '../store/request';
import { FilePreview } from '../components/preview';
import ResultsPreview from '../components/canvas/ResultsPreview';
import useAgentResults from '../store/agentResults';
import LeftPanel from '../components/canvas/LeftPanel';
import RightPanel from '../components/canvas/RightPanel';
import FileUploadModal from '../components/canvas/FileUploadModal';


// import PromptChainsCanvasPanel from "../components/voicebot/PromptChainsCanvasPanel";
// import AgentsCanvasPanel from "../components/voicebot/AgentsCanvasPanel";
import PermissionGate from '../components/PermissionGate';
import { PERMISSIONS } from "../constants/permissions";

const Canvas = () => {
    const {
        projects,
        projectFiles,
        selectedProject,
        selectedFile,
        selectedSession,
        sessions,
        setSelectedProject,
        setSelectedFile,
        setSelectedSession,
        fetchProjects,
        fetchAllProjectFiles,
        buildProjectTree,
        fetchSessions
    } = useProjectFiles();

    const { loading, error } = useRequest();
    const { currentResult, clearResult, hasResult } = useAgentResults();



    // Состояние для загрузки файлов
    const [uploadModalVisible, setUploadModalVisible] = useState(false);
    const [uploadTargetProject, setUploadTargetProject] = useState(null);

    useEffect(() => {
        // Загружаем данные при монтировании компонента
        const loadData = async () => {
            try {
                await fetchProjects();
                await fetchAllProjectFiles();
                await fetchSessions();
            } catch (error) {
                console.error('Error loading data:', error);
            }
        };

        loadData();
    }, [fetchProjects, fetchAllProjectFiles, fetchSessions]);

    useEffect(() => {
        // Строим дерево когда данные загружены
        if (Array.isArray(projects) && Array.isArray(projectFiles)) {
            buildProjectTree();
        }
    }, [projects, projectFiles, sessions, buildProjectTree]);



    // Обработчик выбора элемента в дереве
    const handleSelect = (selectedKeys, info) => {
        if (selectedKeys.length === 0) return;

        const { node } = info;

        if (node.type === 'project') {
            setSelectedProject(node.data);
            setSelectedFile(null);
            setSelectedSession(null);
        } else if (node.type === 'file') {
            setSelectedFile(node.data);
            setSelectedProject(null);
            setSelectedSession(null);
        } else if (node.type === 'session') {
            setSelectedSession(node.data);
            setSelectedProject(null);
            setSelectedFile(null);
        } else {
            // Папка или папка с транскрипциями - сбрасываем выбор
            setSelectedProject(null);
            setSelectedFile(null);
            setSelectedSession(null);
        }
    };

    // Обработчики загрузки файлов
    const handleUploadClick = (project) => {
        setUploadTargetProject(project);
        setUploadModalVisible(true);
    };

    const handleUploadModalCancel = () => {
        setUploadModalVisible(false);
        setUploadTargetProject(null);
    };

    if (error) {
        return (
            <div className="bg-gray-50 p-6">
                <Alert
                    message="Ошибка загрузки данных"
                    description={error}
                    type="error"
                    showIcon
                    closable
                />
            </div>
        );
    }

    return (
        <div className="bg-gray-50 p-6 ">
            <div className="w-full max-w-[1700px] mx-auto">
                {/* Основное содержимое */}
                <div className="flex flex-col lg:flex-row gap-2 min-h-[800px] max-h-[800px] w-full max-w-full">
                    {/* Левая панель */}
                    <LeftPanel
                        onUploadClick={handleUploadClick}
                        onSelect={handleSelect}
                    />

                    {/* Центральная колонка - просмотр файла или результатов агента */}
                    <div className="w-full h-full overflow-hidden">
                        {hasResult() ? (
                            <ResultsPreview
                                result={currentResult}
                                onClear={clearResult}
                            />
                        ) : (
                            <FilePreview />
                        )}
                    </div>

                    {/* Правая панель */}
                    <RightPanel />
                </div>
                <div className='mt-4'>
                    <PermissionGate permission={PERMISSIONS.AGENTS.READ} showFallback={false}>
                        {/* <PromptChainsCanvasPanel /> */}
                        {/* <AgentsCanvasPanel /> */}
                    </PermissionGate>
                </div>
            </div>

            {/* Модальное окно для загрузки файлов */}
            <FileUploadModal
                visible={uploadModalVisible}
                onCancel={handleUploadModalCancel}
                uploadTargetProject={uploadTargetProject}
            />
        </div>
    );
};

export default Canvas;
