import { Button, Divider, Drawer, Form, Input, InputNumber, Space, Tag, Typography } from 'antd';
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
  const [comment, setComment] = useState<string>('');

  useEffect((): void => {
    if (!context) {
      setFactHours(0);
      setFactRub(0);
      setForecastHours(0);
      setForecastRub(0);
      setComment('');
      return;
    }
    const isFix = context.contract_type === 'Fix';
    const fixedRub =
      isFix && (context.values.fact_rub > 0 || context.values.forecast_rub > 0)
        ? Math.max(context.values.fact_rub, context.values.forecast_rub)
        : 0;

    setFactHours(context.values.fact_hours);
    setFactRub(isFix ? fixedRub : context.values.fact_rub);
    setForecastHours(context.values.forecast_hours);
    setForecastRub(isFix ? fixedRub : context.values.forecast_rub);
    const mode = context.edit_mode ?? 'forecast';
    setComment(
      mode === 'fact'
        ? (context.values.fact_comment ?? '')
        : (context.values.forecast_comment ?? ''),
    );
  }, [context]);

  const isTimeAndMaterials = context?.contract_type === 'T&M';
  const isFix = context?.contract_type === 'Fix';
  const rate = context?.rate_rub_per_hour ?? 0;
  const canEditHours = isTimeAndMaterials || isFix;
  const canEditRub = !isTimeAndMaterials && !isFix;

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
    const mode = context.edit_mode ?? 'forecast';
    const cleanedComment = comment.trim();

    // For Fix contracts the amount is fixed and edited in Guides (Projects).
    // In Plan/Fact we only let users enter hours, while keeping the amount identical in plan and fact.
    const fixedRub =
      context.contract_type === 'Fix'
        ? Math.max(context.values.fact_rub, context.values.forecast_rub)
        : 0;

    onApply(context, {
      fact_hours: factHours,
      fact_rub: context.contract_type === 'Fix' ? fixedRub : factRub,
      forecast_hours: forecastHours,
      forecast_rub: context.contract_type === 'Fix' ? fixedRub : forecastRub,
      ...(mode === 'fact'
        ? { fact_comment: cleanedComment }
        : { forecast_comment: cleanedComment }),
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
          <Typography.Text strong>
            {context?.project_name ?? 'Проект'}
          </Typography.Text>
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
          <div>
            <Typography.Text type="secondary">Комментарий</Typography.Text>
            <Input.TextArea
              value={comment}
              onChange={(e): void => setComment(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="Комментарий"
              className="mt-1"
            />
          </div>
          <Divider />
          <Form layout="vertical">
            <Typography.Text strong>Факт</Typography.Text>
            <div className="grid grid-cols-2 gap-4 mt-2">
              <Form.Item label="Часы">
                <InputNumber
                  min={0}
                  value={factHours}
                  disabled={!canEditHours}
                  onChange={handleFactHoursChange}
                  className="w-full"
                />
              </Form.Item>
              <Form.Item label="Сумма ₽">
                <InputNumber
                  min={0}
                  value={factRub}
                  disabled={!canEditRub}
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
                  disabled={!canEditHours}
                  onChange={handleForecastHoursChange}
                  className="w-full"
                />
              </Form.Item>
              <Form.Item label="Сумма ₽">
                <InputNumber
                  min={0}
                  value={forecastRub}
                  disabled={!canEditRub}
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
