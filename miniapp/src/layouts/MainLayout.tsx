import { Outlet } from 'react-router-dom';
import { message } from 'antd';

import { useKanban } from '../store/kanban';

const MainLayout = () => {
    const [messageApi, contextHolder] = message.useMessage();
    const { setupMessageApi } = useKanban();

    setupMessageApi(messageApi);

    return (
        <>
            {contextHolder}
            <div className="flex min-h-[100vh] flex-col bg-black select-text">
                <Outlet />
            </div>
        </>
    );
};

export default MainLayout;
