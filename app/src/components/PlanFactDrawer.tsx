import { Button, Divider, Drawer, Form, InputNumber, Space, Tag, Typography } from 'antd';
import { type ReactElement, useEffect, useState } from 'react';
import { type PlanFactCellContext, type PlanFactMonthCell } from '../services/types';
import { formatCurrency, formatMonthLabel, formatNumber } from '../utils/format';

interface Props {
  open: boolean;
  context: PlanFactCellContext | null;
  onClose: () => void;
  onApply: (context: PlanFactCellContext, values: PlanFactMonthCell) => void;
}

export default function PlanFactDrawer({ open, context, onClose, onApply }: Props): ReactElement {
  const [factHours, setFactHours] = useState<number>(0);
  const [factRub, setFactRub] = useState<number>(0);
  const [forecastHours, setForecastHours] = useState<number>(0);
  const [forecastRub, setForecastRub] = useState<number>(0);

  useEffect((): void => {
    if (!context) {
      return;
    }
    setFactHours(context.values.fact_hours);
    setFactRub(context.values.fact_rub);
    setForecastHours(context.values.forecast_hours);
    setForecastRub(context.values.forecast_rub);
  }, [context]);

  const isTimeAndMaterials = context?.contract_type === 'T&M';
  const rate = context?.rate_rub_per_hour ?? 0;

  const handleFactHoursChange = (value: number | null): void => {
    const hours = value ?? 0;
    setFactHours(hours);
    if (isTimeAndMaterials) {
      setFactRub(Math.round(hours * rate));
    }
  };

  const handleForecastHoursChange = (value: number | null): void => {
    const hours = value ?? 0;
    setForecastHours(hours);
    if (isTimeAndMaterials) {
      setForecastRub(Math.round(hours * rate));
    }
  };

  const handleFactRubChange = (value: number | null): void => {
    setFactRub(value ?? 0);
  };

  const handleForecastRubChange = (value: number | null): void => {
    setForecastRub(value ?? 0);
  };

  const handleApply = (): void => {
    if (!context) {
      return;
    }
    onApply(context, {
      fact_hours: factHours,
      fact_rub: factRub,
      forecast_hours: forecastHours,
      forecast_rub: forecastRub,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={420}
      destroyOnClose
      title={
        <div className="space-y-1">
          <Typography.Text strong>{context?.project_name ?? 'Проект'}</Typography.Text>
          <div className="text-xs text-slate-500">
            {context?.client_name} • {context ? formatMonthLabel(context.month) : ''}
          </div>
        </div>
      }
      footer={
        <div className="flex justify-end">
          <Space>
            <Button onClick={onClose}>Отмена</Button>
            <Button type="primary" onClick={handleApply}>
              Сохранить
            </Button>
          </Space>
        </div>
      }
    >
      {context ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Tag color="blue">{context.contract_type}</Tag>
            {isTimeAndMaterials ? (
              <Typography.Text type="secondary">
                Ставка {formatCurrency(rate)} / час
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">Фиксированная сумма</Typography.Text>
            )}
          </div>
          <Divider />
          <Form layout="vertical">
            <Typography.Text strong>Факт</Typography.Text>
            <div className="grid grid-cols-2 gap-4 mt-2">
              <Form.Item label="Часы">
                <InputNumber
                  min={0}
                  value={factHours}
                  disabled={!isTimeAndMaterials}
                  onChange={handleFactHoursChange}
                  className="w-full"
                />
              </Form.Item>
              <Form.Item label="Сумма ₽">
                <InputNumber
                  min={0}
                  value={factRub}
                  disabled={isTimeAndMaterials}
                  onChange={handleFactRubChange}
                  className="w-full"
                />
              </Form.Item>
            </div>
            <Typography.Text type="secondary">
              Итог: {formatCurrency(factRub)} • {formatNumber(factHours)} ч
            </Typography.Text>
            <Divider />
            <Typography.Text strong>Прогноз</Typography.Text>
            <div className="grid grid-cols-2 gap-4 mt-2">
              <Form.Item label="Часы">
                <InputNumber
                  min={0}
                  value={forecastHours}
                  disabled={!isTimeAndMaterials}
                  onChange={handleForecastHoursChange}
                  className="w-full"
                />
              </Form.Item>
              <Form.Item label="Сумма ₽">
                <InputNumber
                  min={0}
                  value={forecastRub}
                  disabled={isTimeAndMaterials}
                  onChange={handleForecastRubChange}
                  className="w-full"
                />
              </Form.Item>
            </div>
            <Typography.Text type="secondary">
              Итог: {formatCurrency(forecastRub)} • {formatNumber(forecastHours)} ч
            </Typography.Text>
          </Form>
        </div>
      ) : (
        <Typography.Text type="secondary">Выберите ячейку таблицы.</Typography.Text>
      )}
    </Drawer>
  );
}
