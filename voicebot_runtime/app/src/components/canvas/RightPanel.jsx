import React from 'react';
import ContextDisplay from './ContextDisplay';
import PermissionGate from '../PermissionGate';
import { PERMISSIONS } from "../../constants/permissions";


const RightPanel = () => {
    return (
        <div className="w-full lg:w-[300px] flex-shrink-0 h-full flex flex-col">

            <ContextDisplay />
        </div>
    );
};

export default RightPanel;
