import { type PlanFactGridResponse } from './types';

export const mockPlanFact: PlanFactGridResponse = {
  snapshot_date: '2026-01-22T09:00:00+03:00',
  forecast_version_id: 'baseline',
  customers: [
    {
      customer_id: 'c-dbi',
      customer_name: 'DBI',
      totals_by_month: {
        '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 651100, forecast_hours: 383 },
        '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 1281800, forecast_hours: 734 },
        '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 1281800, forecast_hours: 0 },
      },
      projects: [
        {
          project_id: 'p-dbi-metro-spot',
          project_name: 'Metro SPOT',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 120700, forecast_hours: 71 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 272000, forecast_hours: 140 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 272000, forecast_hours: 0 },
          },
        },
        {
          project_id: 'p-dbi-metro-qaudit',
          project_name: 'Metro QAudit',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 54400, forecast_hours: 32 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 54400, forecast_hours: 32 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 54400, forecast_hours: 0 },
          },
        },
        {
          project_id: 'p-dbi-metro-maps',
          project_name: 'Metro Maps',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 81600, forecast_hours: 48 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 136000, forecast_hours: 80 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 136000, forecast_hours: 0 },
          },
        },
        {
          project_id: 'p-dbi-ural-rms',
          project_name: 'Ural RMS',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 54400, forecast_hours: 32 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 54400, forecast_hours: 32 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 54400, forecast_hours: 0 },
          },
        },
        {
          project_id: 'p-dbi-metro-picker',
          project_name: 'Metro Picker',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 150 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 0 },
          },
        },
        {
          project_id: 'p-dbi-metro-supliersup',
          project_name: 'Metro SuplierSup',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 150 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 0 },
          },
        },
        {
          project_id: 'p-dbi-ural-bp',
          project_name: 'Ural BP',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 340000, forecast_hours: 200 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 150 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 0 },
          },
        },
      ],
    },
    {
      customer_id: 'c-1x',
      customer_name: '1x',
      totals_by_month: {
        '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
        '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
        '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
      },
      projects: [
        {
          project_id: 'p-1x-1x',
          project_name: '1x',
          subproject_name: '',
          contract_type: 'Fix',
          rate_rub_per_hour: 937,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
          },
        },
      ],
    },
    {
      customer_id: 'c-sha',
      customer_name: 'Sha',
      totals_by_month: {
        '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 359700, forecast_hours: 48 },
        '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 212500, forecast_hours: 60 },
        '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 212500, forecast_hours: 0 },
      },
      projects: [
        {
          project_id: 'p-sha-jabula',
          project_name: 'Jabula',
          subproject_name: '',
          contract_type: 'Fix',
          rate_rub_per_hour: null,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 180000, forecast_hours: 0 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
          },
        },
        {
          project_id: 'p-sha-hearts-rockstar',
          project_name: 'Hearts Rockstar',
          subproject_name: '',
          contract_type: 'Fix',
          rate_rub_per_hour: 2800,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 112500, forecast_hours: 0 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 112500, forecast_hours: 0 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 112500, forecast_hours: 0 },
          },
        },
        {
          project_id: 'p-sha-cdzd',
          project_name: 'СДЗД',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1400,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 67200, forecast_hours: 48 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 100000, forecast_hours: 60 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 100000, forecast_hours: 0 },
          },
        },
      ],
    },
    {
      customer_id: 'c-ezo',
      customer_name: 'EZO',
      totals_by_month: {
        '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 95200, forecast_hours: 56 },
        '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 238000, forecast_hours: 140 },
        '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 238000, forecast_hours: 0 },
      },
      projects: [
        {
          project_id: 'p-ezo-ezo',
          project_name: 'EZO',
          subproject_name: '',
          contract_type: 'T&M',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 95200, forecast_hours: 56 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 238000, forecast_hours: 140 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 238000, forecast_hours: 0 },
          },
        },
      ],
    },
    {
      customer_id: 'c-titan',
      customer_name: 'Titan',
      totals_by_month: {
        '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
        '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 748000, forecast_hours: 0 },
        '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
      },
      projects: [
        {
          project_id: 'p-titan-tele2',
          project_name: 'Tele2',
          subproject_name: '',
          contract_type: 'Fix',
          rate_rub_per_hour: 1700,
          months: {
            '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
            '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 748000, forecast_hours: 0 },
            '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
          },
        },
      ],
    },
  ],
};
