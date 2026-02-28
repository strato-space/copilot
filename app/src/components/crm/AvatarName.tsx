import { Avatar, Tooltip } from 'antd';

interface AvatarNameProps {
    name?: string | null;
    size?: number;
    className?: string;
}

const buildAvatarInitials = (value: string): string => {
    if (!value || typeof value !== 'string') return '?';
    const parts = value
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (parts.length === 0) return '?';
    return parts
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
};

const AvatarName = ({ name, size = 28, className = '' }: AvatarNameProps) => {
    const safeName = name ? String(name).trim() : '';
    if (!safeName) {
        return (
            <Avatar
                size={size}
                shape="circle"
                className={`bg-slate-100 text-slate-400 border border-slate-200 ${className}`}
            >
                -
            </Avatar>
        );
    }

    return (
        <Tooltip title={safeName} placement="top">
            <Avatar
                size={size}
                shape="circle"
                style={{ fontSize: Math.max(size - 2, 10) }}
                className={`bg-slate-200 text-slate-700 border border-slate-200 ${className}`}
            >
                {buildAvatarInitials(safeName)}
            </Avatar>
        </Tooltip>
    );
};

export default AvatarName;
