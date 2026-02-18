import React from "react";
import { QuestionCircleOutlined, ScheduleOutlined, PieChartOutlined, RollbackOutlined, StockOutlined, ScanOutlined } from "@ant-design/icons";

const iconClassName = "text-black/40 cursor-pointer hover:text-blue-600 transition-colors duration-200 h-3 w-3";

const widgetIcons = {
  questions: QuestionCircleOutlined,
  tasks: ScheduleOutlined,
  pieChart: PieChartOutlined,
  rollback: RollbackOutlined,
  stock: StockOutlined,
  summary: ScanOutlined
};

const WidgetIcon = ({ widgetName }) => {
  const IconComponent = widgetIcons[widgetName];
  return IconComponent ? <IconComponent className={iconClassName} /> : null;
};

export default WidgetIcon;