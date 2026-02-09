import { CoffeeOutlined, QuestionCircleOutlined, ScheduleOutlined } from '@ant-design/icons';

const BottomMenu = () => {
    return (
        <div className="fixed bottom-0 left-0 z-30 w-full">
            <div className="absolute bottom-0 left-0 flex w-full justify-around border-t border-[#2b2b2b] bg-[#0a0a0a] py-2">
                <div className="flex flex-col items-center gap-2">
                    <ScheduleOutlined className="text-[24px]" />
                    <div>tasks</div>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <CoffeeOutlined className="text-[24px]" />
                    <div>holidays</div>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <QuestionCircleOutlined className="text-[24px]" />
                    <div>faq</div>
                </div>
            </div>
        </div>
    );
};

export default BottomMenu;
