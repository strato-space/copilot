import { create } from 'zustand';
import { useRequest } from './request';

export const useProjectFiles = create((set, get) => {

    const api_request = useRequest.getState().api_request;

    return {
        // State
        projects: [],
        projectFiles: [],
        selectedProject: null,
        selectedFile: null,
        projectTree: [],
        viewMode: 'ProjectFiles', // 'ProjectFiles' | 'Transcriptions'
        sessions: [],
        sessionsTree: [],
        selectedSession: null,
        sessionCustomerFilter: null,
        sessionProjectGroupFilter: null,

        // Actions
        setSelectedProject: (project) => set({ selectedProject: project }),
        setSelectedFile: (file) => set({ selectedFile: file }),
        setViewMode: (mode) => set({ viewMode: mode }),
        setSelectedSession: (session) => set({ selectedSession: session }),
        setSessionCustomerFilter: (filter) => set({ sessionCustomerFilter: filter }),
        setSessionProjectGroupFilter: (filter) => set({ sessionProjectGroupFilter: filter }),

        // Fetch projects list
        fetchProjects: async () => {
            try {
                // Запрос списка проектов
                const result = await api_request('voicebot/projects');
                if (Array.isArray(result)) {
                    set({ projects: result });
                }
            } catch (error) {
                console.error('Error fetching projects:', error);
            }
        },

        // Fetch files for specific project
        fetchProjectFiles: async (projectId) => {
            try {
                const result = await api_request('voicebot/get_project_files', { project_id: projectId });
                if (result.success && result.files) {
                    set({ projectFiles: result.files });
                }
            } catch (error) {
                console.error('Error fetching project files:', error);
            }
        },

        // Fetch all project files
        fetchAllProjectFiles: async () => {
            try {
                const result = await api_request('voicebot/get_all_project_files');
                if (Array.isArray(result) || (result.success && result.files)) {
                    const files = Array.isArray(result) ? result : result.files;
                    set({ projectFiles: files });
                    // Перестраиваем дерево после получения файлов
                    get().buildProjectTree();
                }
            } catch (error) {
                console.error('Error fetching all project files:', error);
            }
        },

        // Upload file to project
        uploadFileToProject: async (projectId, files, folderPath = '') => {
            try {
                // Создаем FormData для отправки файлов
                const formData = new FormData();
                formData.append('project_id', projectId);
                formData.append('folder_path', folderPath || '');

                // Добавляем все файлы в FormData
                Array.from(files).forEach(file => {
                    formData.append('files', file);
                });

                // Получаем токен авторизации из store
                const authToken = useRequest.getState().getAuthToken();

                // Отправляем запрос с файлами
                const response = await fetch(`${window.backend_url}/voicebot/upload_file_to_project`, {
                    method: 'POST',
                    headers: {
                        'X-Authorization': authToken
                    },
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    // Обновляем список файлов
                    await get().fetchAllProjectFiles();
                    return result.files;
                } else {
                    throw new Error(result.error || 'Upload failed');
                }
            } catch (error) {
                console.error('Error uploading files:', error);
                throw error;
            }
        },        // Build unified project tree structure (files + sessions)
        buildProjectTree: () => {
            const { projects, projectFiles, sessions } = get();

            if (!Array.isArray(projects) || !Array.isArray(projectFiles)) {
                return;
            }

            const tree = projects.map(project => {
                // Фильтруем файлы по проекту
                const files = projectFiles.filter(file => file.project_id === project._id);

                // Фильтруем сессии по проекту
                const projectSessions = Array.isArray(sessions)
                    ? sessions.filter(session => session.project?._id === project._id)
                    : [];

                // Группируем файлы по папкам
                const folderMap = new Map();

                files.forEach(file => {
                    const pathParts = file.file_path.split('/');
                    const fileName = pathParts.pop();
                    const folderPath = pathParts.join('/');

                    if (!folderMap.has(folderPath)) {
                        folderMap.set(folderPath, []);
                    }

                    folderMap.get(folderPath).push({
                        key: `file-${file._id}`,
                        title: fileName,
                        icon: 'FileOutlined',
                        type: 'file',
                        data: file,
                        isLeaf: true
                    });
                });

                // Создаем структуру папок
                const folderStructure = new Map();

                // Сначала создаем все папки
                for (const [folderPath, files] of folderMap) {
                    if (folderPath === '') {
                        // Файлы в корне проекта
                        if (!folderStructure.has('root')) {
                            folderStructure.set('root', { files: [], folders: new Map() });
                        }
                        folderStructure.get('root').files.push(...files);
                    } else {
                        // Создаем вложенную структуру папок
                        const parts = folderPath.split('/').filter(p => p.length > 0);
                        let currentPath = '';

                        parts.forEach((part, index) => {
                            const parentPath = currentPath;
                            currentPath = currentPath ? `${currentPath}/${part}` : part;

                            if (!folderStructure.has(currentPath)) {
                                folderStructure.set(currentPath, { files: [], folders: new Map() });
                            }

                            if (index === parts.length - 1) {
                                // Последняя папка - добавляем файлы
                                folderStructure.get(currentPath).files.push(...files);
                            }
                        });
                    }
                }

                // Строим дерево из структуры папок
                const buildFolderTree = (path, name = null) => {
                    const structure = folderStructure.get(path);
                    if (!structure) return [];

                    const children = [];

                    // Добавляем файлы
                    children.push(...structure.files);

                    // Добавляем подпапки
                    for (const [fullPath, _] of folderStructure) {
                        if (fullPath !== path && fullPath.startsWith(path + '/')) {
                            const relativePath = fullPath.substring(path.length + 1);
                            if (!relativePath.includes('/')) {
                                // Это прямая подпапка
                                children.push({
                                    key: `folder-${project._id}-${fullPath}`,
                                    title: relativePath,
                                    icon: 'FolderOutlined',
                                    type: 'folder',
                                    children: buildFolderTree(fullPath, relativePath)
                                });
                            }
                        }
                    }

                    return children;
                };

                // Строим дерево для корня проекта
                let children = [];

                // Файлы в корне
                const rootStructure = folderStructure.get('root');
                if (rootStructure) {
                    children.push(...rootStructure.files);
                }

                // Папки первого уровня
                for (const [fullPath, _] of folderStructure) {
                    if (fullPath !== 'root' && !fullPath.includes('/')) {
                        children.push({
                            key: `folder-${project._id}-${fullPath}`,
                            title: fullPath,
                            icon: 'FolderOutlined',
                            type: 'folder',
                            children: buildFolderTree(fullPath)
                        });
                    }
                }

                // Добавляем сессии, если они есть
                if (projectSessions.length > 0) {
                    const sessionsNode = {
                        key: `sessions-folder-${project._id}`,
                        title: `Транскрипции (${projectSessions.length})`,
                        icon: 'FolderOutlined',
                        type: 'sessions-folder',
                        children: projectSessions.map(session => ({
                            key: `session-${session._id}`,
                            title: session.session_name || 'Безымянная сессия',
                            icon: 'FileTextOutlined',
                            type: 'session',
                            data: session,
                            isLeaf: true
                        })),
                        isLeaf: false
                    };
                    children.push(sessionsNode);
                }

                return {
                    key: `project-${project._id}`,
                    title: project.name || `Проект ${project._id}`,
                    icon: 'ProjectOutlined',
                    type: 'project',
                    data: project,
                    children: children
                };
            });

            set({ projectTree: tree });
        },

        // Clear selected items
        clearSelection: () => set({ selectedProject: null, selectedFile: null }),

        // Fetch sessions list
        fetchSessions: async () => {
            try {
                const result = await api_request('voicebot/sessions');
                if (Array.isArray(result)) {
                    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    set({ sessions: result });
                    // Перестраиваем основное дерево после получения сессий
                    get().buildProjectTree();
                    // Также строим дерево сессий для совместимости
                    get().buildSessionsTree();
                }
            } catch (error) {
                console.error('Error fetching sessions:', error);
            }
        },

        // Build sessions tree structure
        buildSessionsTree: () => {
            const { sessions, projects } = get();

            if (!Array.isArray(sessions) || !Array.isArray(projects)) {
                return;
            }

            // Группируем сессии по группе проектов
            const groupMap = new Map();

            sessions.forEach(session => {
                const project = projects.find(p => p._id === session.project?._id);
                const projectGroupName = project?.project_group?.name || 'Без группы';
                const projectGroupId = project?.project_group?._id || 'no-group';

                if (!groupMap.has(projectGroupId)) {
                    groupMap.set(projectGroupId, {
                        name: projectGroupName,
                        projects: new Map()
                    });
                }

                const group = groupMap.get(projectGroupId);
                const projectName = project?.name || 'Без проекта';
                const projectId = project?._id || 'no-project';

                if (!group.projects.has(projectId)) {
                    group.projects.set(projectId, {
                        name: projectName,
                        sessions: []
                    });
                }

                group.projects.get(projectId).sessions.push({
                    key: `session-${session._id}`,
                    title: session.session_name || 'Безымянная сессия',
                    icon: 'FileOutlined',
                    type: 'session',
                    data: session,
                    isLeaf: true
                });
            });

            // Строим дерево
            const tree = [];
            for (const [groupId, group] of groupMap) {
                const projectNodes = [];
                for (const [projectId, project] of group.projects) {
                    if (project.sessions.length > 0) {
                        projectNodes.push({
                            key: `project-sessions-${projectId}`,
                            title: `${project.name} (${project.sessions.length})`,
                            icon: 'ProjectOutlined',
                            type: 'project',
                            children: project.sessions
                        });
                    }
                }

                if (projectNodes.length > 0) {
                    tree.push({
                        key: `group-sessions-${groupId}`,
                        title: `${group.name} (${projectNodes.reduce((sum, p) => sum + p.children.length, 0)})`,
                        icon: 'FolderOutlined',
                        type: 'group',
                        children: projectNodes
                    });
                }
            }

            set({ sessionsTree: tree });
        },

        // Build filtered sessions tree structure
        buildFilteredSessionsTree: () => {
            const { sessions, projects, sessionCustomerFilter, sessionProjectGroupFilter } = get();

            if (!Array.isArray(sessions) || !Array.isArray(projects)) {
                return [];
            }

            // Фильтруем сессии
            const filteredSessions = sessions.filter(session => {
                const project = projects.find(p => p._id === session.project?._id);

                if (sessionCustomerFilter && project?.customer?._id !== sessionCustomerFilter) {
                    return false;
                }
                if (sessionProjectGroupFilter && project?.project_group?._id !== sessionProjectGroupFilter) {
                    return false;
                }
                return true;
            });

            // Группируем отфильтрованные сессии по группе проектов
            const groupMap = new Map();

            filteredSessions.forEach(session => {
                const project = projects.find(p => p._id === session.project?._id);
                const projectGroupName = project?.project_group?.name || 'Без группы';
                const projectGroupId = project?.project_group?._id || 'no-group';

                if (!groupMap.has(projectGroupId)) {
                    groupMap.set(projectGroupId, {
                        name: projectGroupName,
                        projects: new Map()
                    });
                }

                const group = groupMap.get(projectGroupId);
                const projectName = project?.name || 'Без проекта';
                const projectId = project?._id || 'no-project';

                if (!group.projects.has(projectId)) {
                    group.projects.set(projectId, {
                        name: projectName,
                        sessions: []
                    });
                }

                group.projects.get(projectId).sessions.push({
                    key: `session-${session._id}`,
                    title: session.session_name || 'Безымянная сессия',
                    icon: 'FileOutlined',
                    type: 'session',
                    data: session,
                    isLeaf: true
                });
            });

            // Строим дерево
            const tree = [];
            for (const [groupId, group] of groupMap) {
                const projectNodes = [];
                for (const [projectId, project] of group.projects) {
                    if (project.sessions.length > 0) {
                        projectNodes.push({
                            key: `project-sessions-${projectId}`,
                            title: `${project.name} (${project.sessions.length})`,
                            icon: 'ProjectOutlined',
                            type: 'project',
                            children: project.sessions
                        });
                    }
                }

                if (projectNodes.length > 0) {
                    tree.push({
                        key: `group-sessions-${groupId}`,
                        title: `${group.name} (${projectNodes.reduce((sum, p) => sum + p.children.length, 0)})`,
                        icon: 'FolderOutlined',
                        type: 'group',
                        children: projectNodes
                    });
                }
            }

            return tree;
        },

        // Build filtered unified project tree structure
        buildFilteredProjectTree: (customerFilter, projectGroupFilter) => {
            const { projects, projectFiles, sessions } = get();

            if (!Array.isArray(projects) || !Array.isArray(projectFiles)) {
                return [];
            }

            // Фильтруем проекты
            const filteredProjects = projects.filter(project => {
                if (customerFilter && project.customer?._id !== customerFilter) {
                    return false;
                }
                if (projectGroupFilter && project.project_group?._id !== projectGroupFilter) {
                    return false;
                }
                return true;
            });

            return filteredProjects.map(project => {
                // Фильтруем файлы по проекту
                const files = projectFiles.filter(file => file.project_id === project._id);

                // Фильтруем сессии по проекту
                const projectSessions = Array.isArray(sessions)
                    ? sessions.filter(session => session.project?._id === project._id)
                    : [];

                // Группируем файлы по папкам
                const folderMap = new Map();

                files.forEach(file => {
                    // Проверяем, что file_path существует, если нет - используем имя файла
                    const filePath = file.file_path || file.file_name || '';
                    const pathParts = filePath.split('/');
                    const fileName = pathParts.pop() || file.file_name || 'Unknown file';
                    const folderPath = pathParts.join('/');

                    if (!folderMap.has(folderPath)) {
                        folderMap.set(folderPath, []);
                    }

                    folderMap.get(folderPath).push({
                        key: `file-${file._id}`,
                        title: fileName,
                        icon: 'FileOutlined',
                        type: 'file',
                        data: file,
                        isLeaf: true
                    });
                });

                // Создаем структуру папок (аналогично buildProjectTree)
                const folderStructure = new Map();

                for (const [folderPath, files] of folderMap) {
                    if (folderPath === '') {
                        if (!folderStructure.has('root')) {
                            folderStructure.set('root', { files: [], folders: new Map() });
                        }
                        folderStructure.get('root').files.push(...files);
                    } else {
                        const parts = folderPath.split('/').filter(p => p.length > 0);
                        let currentPath = '';

                        parts.forEach((part, index) => {
                            const parentPath = currentPath;
                            currentPath = currentPath ? `${currentPath}/${part}` : part;

                            if (!folderStructure.has(currentPath)) {
                                folderStructure.set(currentPath, { files: [], folders: new Map() });
                            }

                            if (index === parts.length - 1) {
                                folderStructure.get(currentPath).files.push(...files);
                            }
                        });
                    }
                }

                // Строим дерево из структуры папок
                const buildFolderTree = (path, name = null) => {
                    const structure = folderStructure.get(path);
                    if (!structure) return [];

                    const children = [];
                    children.push(...structure.files);

                    for (const [fullPath, _] of folderStructure) {
                        if (fullPath !== path && fullPath.startsWith(path + '/')) {
                            const relativePath = fullPath.substring(path.length + 1);
                            if (!relativePath.includes('/')) {
                                children.push({
                                    key: `folder-${project._id}-${fullPath}`,
                                    title: relativePath,
                                    icon: 'FolderOutlined',
                                    type: 'folder',
                                    children: buildFolderTree(fullPath, relativePath)
                                });
                            }
                        }
                    }

                    return children;
                };

                let children = [];

                const rootStructure = folderStructure.get('root');
                if (rootStructure) {
                    children.push(...rootStructure.files);
                }

                for (const [fullPath, _] of folderStructure) {
                    if (fullPath !== 'root' && !fullPath.includes('/')) {
                        children.push({
                            key: `folder-${project._id}-${fullPath}`,
                            title: fullPath,
                            icon: 'FolderOutlined',
                            type: 'folder',
                            children: buildFolderTree(fullPath)
                        });
                    }
                }

                // Добавляем сессии, если они есть
                if (projectSessions.length > 0) {
                    const sessionsNode = {
                        key: `sessions-folder-${project._id}`,
                        title: `Транскрипции (${projectSessions.length})`,
                        icon: 'FolderOutlined',
                        type: 'sessions-folder',
                        children: projectSessions.map(session => ({
                            key: `session-${session._id}`,
                            title: session.session_name || 'Безымянная сессия',
                            icon: 'FileTextOutlined',
                            type: 'session',
                            data: session,
                            isLeaf: true
                        })),
                        isLeaf: false
                    };
                    children.push(sessionsNode);
                }

                return {
                    key: `project-${project._id}`,
                    title: project.name || `Проект ${project._id}`,
                    icon: 'ProjectOutlined',
                    type: 'project',
                    data: project,
                    children: children
                };
            });
        }
    };
});
