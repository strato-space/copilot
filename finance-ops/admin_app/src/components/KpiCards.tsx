import { Card, Col, Row, Statistic, Typography } from 'antd';
import { type ReactElement } from 'react';
import { type PlanFactClientRow, type PlanFactGridResponse } from '../services/types';
import { useFxStore } from '../store/fxStore';
import { formatCurrency, formatNumber } from '../utils/format';

interface Props {
  data: PlanFactGridResponse | null;
  focusMonth: string;
}

const sumByMonth = (
  data: PlanFactGridResponse | null,
  focusMonth: string,
): { fact: number; forecast: number; factHours: number; forecastHours: number } => {
  if (!data) {
    return { fact: 0, forecast: 0, factHours: 0, forecastHours: 0 };
  }
  let fact = 0;
  let forecast = 0;
  let factHours = 0;
  let forecastHours = 0;
  data.clients.forEach((client: PlanFactClientRow): void => {
    const cell = client.totals_by_month[focusMonth];
    if (cell) {
      fact += cell.fact_rub;
      forecast += cell.forecast_rub;
      factHours += cell.fact_hours;
      forecastHours += cell.forecast_hours;
    }
  });
  return { fact, forecast, factHours, forecastHours };
};

export default function KpiCards({ data, focusMonth }: Props): ReactElement {
  const fxRates = useFxStore((state) => state.rates);
  const totals = sumByMonth(data, focusMonth);
  const fxFactor = fxRates[focusMonth]?.base ? fxRates[focusMonth].rate / fxRates[focusMonth].base : 1;
  const factRub = totals.fact * fxFactor;
  const forecastRub = totals.forecast * fxFactor;
  const variance = factRub - forecastRub;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12} lg={6}>
        <Card className="h-[160px] flex flex-col justify-between">
          <Typography.Text type="secondary">Выручка, факт</Typography.Text>
          <Statistic
            value={factRub}
            formatter={(value: string | number): string => formatCurrency(Number(value))}
          />
        </Card>
      </Col>
      <Col xs={24} md={12} lg={6}>
        <Card className="h-[160px] flex flex-col justify-between">
          <Typography.Text type="secondary">Выручка, прогноз</Typography.Text>
          <Statistic
            value={forecastRub}
            formatter={(value: string | number): string => formatCurrency(Number(value))}
          />
        </Card>
      </Col>
      <Col xs={24} md={12} lg={6}>
        <Card className="h-[160px] flex flex-col justify-between">
          <Typography.Text type="secondary">Отклонение, ₽</Typography.Text>
          <Statistic
            value={variance}
            valueStyle={{ color: variance >= 0 ? '#16a34a' : '#dc2626' }}
            formatter={(value: string | number): string => formatCurrency(Number(value))}
          />
        </Card>
      </Col>
      <Col xs={24} md={12} lg={6}>
        <Card className="h-[160px] flex flex-col">
          <Typography.Text type="secondary">Часы, факт</Typography.Text>
          <Statistic
            value={totals.factHours}
            formatter={(value: string | number): string => formatNumber(Number(value))}
          />
          <Typography.Text type="secondary" className="mt-auto">
            Прогноз: {formatNumber(totals.forecastHours)} ч
          </Typography.Text>
        </Card>
      </Col>
    </Row>
  );
}
