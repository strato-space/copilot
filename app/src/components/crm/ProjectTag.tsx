import { Tag, Tooltip } from 'antd';

interface ProjectTagProps {
    name?: string | null;
    tooltip?: string | null;
    className?: string;
}

const shortenMiddle = (value: string, max = 7): string => {
    const text = String(value);
    if (text.length <= max) return text;
    const head = Math.ceil((max - 1) / 2);
    const tail = max - 1 - head;
    return `${text.slice(0, head)}…${text.slice(-tail)}`;
};

const ProjectTag = ({ name, tooltip, className = '' }: ProjectTagProps) => {
    const safeName = name ? String(name).trim() : '';
    if (!safeName) {
        return <Tag className={`bg-slate-100 border-slate-200 text-slate-400 ${className}`}>—</Tag>;
    }
    const title = tooltip ? String(tooltip).trim() : safeName;
    const displayName = shortenMiddle(safeName, 7);
    return (
        <Tooltip title={title} placement="top">
            <Tag
                className={`max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap bg-slate-100 border-slate-200 text-slate-700 ${className}`}
            >
                {displayName}
            </Tag>
        </Tooltip>
    );
};

export default ProjectTag;
