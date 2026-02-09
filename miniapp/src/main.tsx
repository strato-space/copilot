import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import './index.css';
import LoadingScreen from './components/LoadingScreen';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
        <Suspense fallback={<LoadingScreen />}>
            <App />
        </Suspense>
    </BrowserRouter>
);
