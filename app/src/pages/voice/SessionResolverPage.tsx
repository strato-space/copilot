import { useEffect, useState } from 'react';
import axios from 'axios';
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

type ActiveSessionPayload = {
    active_session?: {
        session_id?: string;
    } | null;
    data?: {
        active_session?: {
            session_id?: string;
        } | null;
    };
};

const resolveBackendUrl = (): string => {
    if (typeof window !== 'undefined') {
        const win = window as { backend_url?: string };
        if (typeof win.backend_url === 'string' && win.backend_url.trim()) {
            return win.backend_url.trim();
        }
    }
    return import.meta.env.VITE_VOICEBOT_BASE_URL ?? '/api';
};

export default function SessionResolverPage() {
    const navigate = useNavigate();
    const authToken = useAuthStore((s) => s.authToken);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let disposed = false;
        const run = async () => {
            setLoading(true);
            setError(null);
            try {
                const backendUrl = resolveBackendUrl().replace(/\/+$/, '');
                const response = await axios.post<ActiveSessionPayload>(
                    `${backendUrl}/voicebot/active_session`,
                    {},
                    {
                        headers: {
                            'X-Authorization': authToken ?? '',
                        },
                        withCredentials: true,
                    }
                );
                if (disposed) return;
                const payload = response.data || {};
                const active = payload?.data?.active_session ?? payload?.active_session ?? null;
                const sessionId = typeof active?.session_id === 'string' ? active.session_id.trim() : '';
                if (sessionId) {
                    navigate(`/voice/session/${sessionId}`, { replace: true });
                    return;
                }
                setError('Активная сессия не найдена');
            } catch (err) {
                if (disposed) return;
                console.error('Failed to resolve active session', err);
                setError('Не удалось получить активную сессию');
            } finally {
                if (!disposed) setLoading(false);
            }
        };

        void run();
        return () => {
            disposed = true;
        };
    }, [authToken, navigate]);

    if (loading) {
        return (
            <div className="min-h-[280px] flex items-center justify-center">
                Загрузка активной сессии...
            </div>
        );
    }

    return (
        <div className="min-h-[280px] flex flex-col items-center justify-center gap-3">
            <div>{error ?? 'Активная сессия не найдена'}</div>
            <Button type="primary" onClick={() => navigate('/voice/sessions')}>
                Открыть список сессий
            </Button>
        </div>
    );
}
