import dayjs from 'dayjs';

export const formatCurrency = (value: number): string => {
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(value);
  return `${formatted} ₽`;
};

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);

export const formatHours = (value: number): string => `${formatNumber(value)} ч`;

export const formatMonthLabel = (month: string): string =>
  dayjs(`${month}-01`).format('DD.MM.YY');

export const formatDateLabel = (value?: string): string => {
  if (!value) {
    return '—';
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    return dayjs(`${value}-01`).format('DD.MM.YY');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dayjs(value).format('DD.MM.YY');
  }
  return value;
};
