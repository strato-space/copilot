import React from "react";
import { Tooltip } from "antd";
import WidgetIcon from "./WidgetIcon.jsx";
import Question from "./widget-items/questions.jsx";

const widgetComponentMap = {
  questions: Question,
  // ...добавьте другие виджеты по мере необходимости
};

const getWidgetComponent = (name) => widgetComponentMap[name] || (() => null);

function CategorizationTableSummary({ summary, widgets }) {
  const widgetNames = widgets ? Object.keys(widgets) : [];

  return (
    <div className="w-[136px] flex flex-col justify-start items-start overflow-hidden flex-1-0-0">
      <div className="p-2 flex flex-col grow justify-between items-stretch">
        <div className="inline-flex justify-end items-start gap-[8px]">
          <div className="flex flex-1 justify-end items-center gap-[8px]">
            {widgetNames.map((name) => {
              const WidgetComponent = getWidgetComponent(name);
              const data = widgets[name];
              if (
                data == null ||
                (Array.isArray(data) && data.length === 0) ||
                (typeof data === "string" && data.trim() === "")
              ) {
                return null;
              }
              const items = Array.isArray(data)
                ? data.map((item, idx, arr) => {
                  const element = WidgetComponent === Question
                    ? <WidgetComponent key={item.id || idx} q={item} />
                    : <WidgetComponent key={item.id || idx} {...(typeof item === 'object' ? item : { value: item })} />;
                  if (idx < arr.length - 1) {
                    return (
                      <div key={item.id || idx}>
                        {element}
                        <div className="border-b border-dashed border-gray-200 my-1" />
                      </div>
                    );
                  }
                  return element;
                })
                : [
                  WidgetComponent === Question
                    ? <WidgetComponent key={name} q={data} />
                    : <WidgetComponent key={name} {...(typeof data === 'object' ? data : { value: data })} />
                ];
              return (
                <Tooltip
                  key={name}
                  title={
                    <div
                      className="flex flex-col gap-1"
                      style={{ maxHeight: 300, overflowY: 'auto', background: '#fff' }}
                    >
                      {items}
                    </div>
                  }
                  placement="top"
                  styles={{ body: { background: '#fff' } }}
                  classNames={{ root: "max-w-[320px]" }}
                >
                  <div className="flex justify-center items-center">
                    <WidgetIcon widgetName={name} />
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </div>
        {
          summary.text ?
            <div className="justify-center text-black/90 text-[9px] font-normal sf-pro leading-[10px] pt-4">{summary.text}</div> :
            <div className=""></div>
        }
      </div>
    </div>
  );
}

export default CategorizationTableSummary;
