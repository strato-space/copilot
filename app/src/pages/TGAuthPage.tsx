import { Spin } from 'antd';
import { useTokenAuth } from '../hooks/useTokenAuth';

export default function TGAuthPage() {
    const { isTokenAuthInProgress } = useTokenAuth();

    return (
        <div className="min-h-[300px] flex items-center justify-center">
            {isTokenAuthInProgress ? <Spin size="large" /> : 'Перенаправление...'}
        </div>
    );
}
