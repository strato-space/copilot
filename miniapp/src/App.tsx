import { Route, Routes } from 'react-router-dom';

import MainLayout from './layouts/MainLayout';
import KanbanPage from './pages/KanbanPage';
import LoadingScreen from './components/LoadingScreen';

import { useAuthUser } from './store/auth';

const App = () => {
    const { isAuth, login, loading } = useAuthUser();

    if (!isAuth) {
        if (!loading) {
            void login();
        }
        return <LoadingScreen />;
    }

    return (
        <Routes>
            <Route path="/" element={<MainLayout />}>
                <Route index element={<KanbanPage />} />
            </Route>
        </Routes>
    );
};

export default App;
