import { type ReactElement, type ReactNode } from 'react';
import { Typography } from 'antd';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  extra?: ReactNode;
}

export default function PageHeader({
  title,
  description,
  actions,
  extra,
}: PageHeaderProps): ReactElement {
  return (
    <div className="finops-page-header">
      <div className="finops-header-top">
        <Typography.Title level={3} className="finops-header-title !mb-0">
          {title}
        </Typography.Title>
        {actions ? <div className="finops-header-actions flex items-center gap-3">{actions}</div> : null}
      </div>
      {description ? <div className="mt-2 text-sm text-slate-600">{description}</div> : null}
      {extra ? <div className="mt-3">{extra}</div> : null}
    </div>
  );
}
