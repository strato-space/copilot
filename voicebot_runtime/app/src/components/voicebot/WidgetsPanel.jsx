import { QuestionCircleOutlined, ScheduleOutlined, PieChartOutlined, RollbackOutlined, StockOutlined, ScanOutlined } from "@ant-design/icons";
import { message, Table, ConfigProvider } from "antd";
import Widget from "./Widget"; // Assuming Widget is a component that you want to use for each icon
import Question from "./widget-items/questions";
import _ from "lodash";
import { useCallback, useMemo } from "react";

import { useVoiceBot } from "../../store/voiceBot";

const WidgetsPanel = () => {
  const { voiceBotSession, voiceMesagesData, setHighlightedMessageId } = useVoiceBot();

  // Мемоизируем обработчики событий
  const handleMouseEnter = useCallback((messageId) => {
    setHighlightedMessageId(messageId);
  }, [setHighlightedMessageId]);

  const handleMouseLeave = useCallback(() => {
    setHighlightedMessageId(null);
  }, [setHighlightedMessageId]);

  // Собрать все вопросы из всех сообщений (теперь из voiceMesagesData)
  const questions = (voiceMesagesData || []).flatMap(group =>
    (_.reverse(group.widgets?.questions) || [])
  );
  questions.sort((a, b) => {
    return b.message_id - a.message_id;
  });
  /*

    groups.sort((a, b) => {
      a.type = a.original_message?.source_type || voice_message_sources.TELEGRAM;
      b.type = b.original_message?.source_type || voice_message_sources.TELEGRAM;

      let comparison = 0;
      if (a.type !== voice_message_sources.TELEGRAM || b.type !== voice_message_sources.TELEGRAM) {
        if (a.message_timestamp > b.message_timestamp) comparison = -1;
        else if (a.message_timestamp < b.message_timestamp) comparison = 1;
      } else {
        if (a.message_id > b.message_id) comparison = -1;
        else if (a.message_id < b.message_id) comparison = 1;
      }

      // Применяем порядок сортировки
      return categorizationSort.ascending ? -comparison : comparison;
    });


  */
  // Сформировать items для Widget, используя все атрибуты объекта question
  const items = questions.map((q) => (
    <Question key={q.id} q={q} />
  ));

  // Мемоизируем обработку данных для предотвращения пересортировки
  const custom_widgets = useMemo(() => {
    const widgets = {}
    for (const message of voiceMesagesData) {
      if (message.widgets) {
        for (const [key, value] of Object.entries(message.widgets)) {
          if (key === "questions") continue;
          if (value && Array.isArray(value)) {
            if (!widgets[key]) {
              widgets[key] = [];
            }
            widgets[key] = widgets[key].concat(_.reverse([...value]));
          }
        }
      }
    }

    //sort custom_widgets by message_id
    for (const [key, value] of Object.entries(widgets)) {
      widgets[key] = value.sort((a, b) => {
        return b.message_id - a.message_id;
      });
    }

    return widgets;
  }, [voiceMesagesData]);

  const question_table = useMemo(() => {
    const table = []
    let index = 0;
    for (const [widget_name, data] of Object.entries(custom_widgets)) {
      for (const message_row of data) {
        table.push({
          id: `${widget_name}-${index++}`,
          widget: widget_name,
          question: message_row.result || "",
          message_id: message_row.message_id || "",
        })
      }
    }
    return table;
  }, [custom_widgets]);

  return (
    <div className="flex gap-2 flex-wrap w-[746px]">
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
          scroll={{ y: 720 }}
          sticky={{ offsetHeader: 0 }}
          pagination={{
            position: ['topRight'],
            defaultPageSize: 15,
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
            pageSizeOptions: ['10', '15', '30', '50', '100'],
            className: 'bg-white p-4 !m-0 !mb-2 rounded-lg shadow-sm',
          }}
          dataSource={question_table}
          rowKey="id"
          onRow={(record) => ({
            onMouseEnter: () => {
              handleMouseEnter(record.message_id);
            },
            onMouseLeave: () => {
              handleMouseLeave();
            },
          })}
          columns={[
            // {
            //   title:"m.id",
            //   dataIndex: "message_id",
            //   key: "message_id",              
            //   render: (text, record) => (
            //     <div className="w-[24px] text-black/90 text-[8px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
            //       {record.message_id}
            //     </div>
            //   ),
            // },
            {
              title: "Виджет",
              dataIndex: "widget",
              key: "widget",
              width: 96,
              render: (text, record) => (
                <div className="text-black/90 text-[8px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                  {record.widget}
                </div>
              ),
            },
            {
              title: "Вопросы",
              dataIndex: "question",
              key: "question",
              render: (text, record) => (
                <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                  {record.question}
                </div>
              ),
            },]}
        />
      </ConfigProvider>

      {/* <Widget
        title="Вопросы"
        version={"1.0.0"}
        versionDate={"04.06"}
        icon={<QuestionCircleOutlined className="text-black/40" />}
        items={items}
      />
      {
        Object.entries(custom_widgets).map(([widget_name, data]) => {
          return (
            <Widget
              key={widget_name}
              title={widget_name}
              version={"0.1.0"}
              versionDate={"11.07"}
              icon={<></>}
              items={data.map((item) => (
                <div className="flex-1 justify-center">
                  <div className="text-black/90 text-[11px] font-normal sf-pro leading-[14px] whitespace-pre-wrap">
                    {item.result}
                  </div>
                </div>
              )) || []}
            />
          );
        })
      } */}
    </div>
  );
}

export default WidgetsPanel