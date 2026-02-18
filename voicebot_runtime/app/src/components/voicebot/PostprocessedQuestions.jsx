import { QuestionCircleOutlined, ScheduleOutlined, PieChartOutlined, RollbackOutlined, StockOutlined, ScanOutlined } from "@ant-design/icons";
import { message, Table, ConfigProvider } from "antd";
import Widget from "./Widget"; // Assuming Widget is a component that you want to use for each icon
import Question from "./widget-items/questions";
import _ from "lodash";
import { useCallback, useMemo } from "react";

import { useVoiceBot } from "../../store/voiceBot";

const PostprocessedQuestions = () => {
  const { voiceBotSession, voiceMesagesData, setHighlightedMessageId } = useVoiceBot();
  
  return (
    <div className="flex gap-2 flex-wrap">
      <ConfigProvider
        theme={{
          components: {
            Table: {
              cellPaddingBlockSM: 4,
            },
          },
        }}
      >
        <Table
          className="w-full smart-scroll"
          size="small"
          sticky={{ offsetHeader: 0 }}
          pagination={{
            position: ['bottomRight'],
            defaultPageSize: 15,
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
            pageSizeOptions: ['10', '15', '30', '50', '100'],
            className: 'bg-white p-4 !m-0 !mb-2 rounded-lg shadow-sm',
          }}
          dataSource={voiceBotSession?.processors_data?.FINAL_CUSTOM_PROMPT?.data || []}
          rowKey="id"
          columns={[{
            title: "Вопросы",
            dataIndex: "result",
            key: "question",
            render: (text, record) => (
                <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                  {record.result}
                </div>
              ),
            },]}
        />
      </ConfigProvider>
    </div>
  );
}

export default PostprocessedQuestions