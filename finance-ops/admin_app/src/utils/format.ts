import dayjs from 'dayjs';

export const formatCurrency = (value: number): string => {
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
    useGrouping: false,
  }).format(value);
  return `${formatted} ₽`;
};

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);

export const formatHours = (value: number): string => `${formatNumber(value)} ч`;

export const formatMonthLabel = (month: string): string =>
  dayjs(`${month}-01`).format('MMM YYYY');
