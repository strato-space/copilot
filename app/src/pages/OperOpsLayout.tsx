/**
 * OperOpsLayout - Layout wrapper for OperOps pages with navigation
 */

import { type ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import OperOpsNav from '../components/crm/OperOpsNav';

export default function OperOpsLayout(): ReactElement {
    return (
        <div className="operops-layout">
            <OperOpsNav />
            <div className="operops-content">
                <Outlet />
            </div>
        </div>
    );
}
