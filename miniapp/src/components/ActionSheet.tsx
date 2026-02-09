import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ActionSheetProps {
    children: ReactNode;
    onClose: () => void;
}

const ActionSheet = ({ children, onClose }: ActionSheetProps) => {
    return createPortal(
        <div className="fixed left-0 top-0 z-50 h-full w-full">
            <div className="absolute left-0 top-0 h-full w-full bg-black/50" />
            <div className="absolute bottom-0 left-0 flex max-h-full w-full flex-col rounded-t-[10px] border-t border-[#2b2b2b] bg-[#1a1a1a] pb-4 pt-4">
                <div
                    className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center"
                    onClick={onClose}
                >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M11 0.999848C10.8437 0.843622 10.6318 0.755859 10.4108 0.755859C10.1898 0.755859 9.97791 0.843622 9.82164 0.999848L5.99997 4.82152L2.1783 0.999848C2.02203 0.843622 1.81011 0.755859 1.58914 0.755859C1.36817 0.755859 1.15624 0.843622 0.99997 0.999848C0.843744 1.15612 0.755981 1.36804 0.755981 1.58901C0.755981 1.80998 0.843744 2.02191 0.99997 2.17818L4.82164 5.99985L0.99997 9.82152C0.843744 9.97779 0.755981 10.1897 0.755981 10.4107C0.755981 10.6317 0.843744 10.8436 0.99997 10.9998C1.15624 11.1561 1.36817 11.2438 1.58914 11.2438C1.81011 11.2438 2.02203 11.1561 2.1783 10.9998L5.99997 7.17818L9.82164 10.9998C9.97791 11.1561 10.1898 11.2438 10.4108 11.2438C10.6318 11.2438 10.8437 11.1561 11 10.9998C11.1562 10.8436 11.244 10.6317 11.244 10.4107C11.244 10.1897 11.1562 9.97779 11 9.82152L7.1783 5.99985L11 2.17818C11.1562 2.02191 11.244 1.80998 11.244 1.58901C11.244 1.36804 11.1562 1.15612 11 0.999848Z"
                            fill="white"
                        />
                    </svg>
                </div>
                {children}
            </div>
        </div>,
        document.body
    );
};

export default ActionSheet;
