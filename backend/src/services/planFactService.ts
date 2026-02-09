import { type Collection } from 'mongodb';
import { connectDb } from './db.js';
import { COLLECTIONS } from '../constants.js';
import { type Client, type FactProjectMonth, type ForecastProjectMonth, type Project } from '../models/types.js';
import { loadCrmSnapshotMeta } from './crmIngest.js';

export interface PlanFactMonthCell {
  fact_rub: number;
  fact_hours: number;
  forecast_rub: number;
  forecast_hours: number;
  fact_comment?: string;
  forecast_comment?: string;
}

export interface PlanFactProjectRow {
  project_id: string;
  project_name: string;
  subproject_name: string;
  contract_type: string;
  rate_rub_per_hour?: number | null;
  months: Record<string, PlanFactMonthCell>;
}

export interface PlanFactClientRow {
  client_id: string;
  client_name: string;
  totals_by_month: Record<string, PlanFactMonthCell>;
  projects: PlanFactProjectRow[];
}

export interface PlanFactGridResponse {
  snapshot_date: string | null;
  forecast_version_id: string;
  clients: PlanFactClientRow[];
}

export interface UpsertFactParams {
  project_id: string;
  month: string;
  contract_type: FactProjectMonth['type'];
  billed_hours: number;
  billed_amount_rub: number;
  comment?: string | null;
}

export interface UpsertForecastParams {
  forecast_version_id: string;
  project_id: string;
  month: string;
  contract_type: ForecastProjectMonth['type'];
  forecast_hours: number;
  forecast_amount_rub: number;
  comment?: string | null;
}

const getClients = async (): Promise<Client[]> => {
  const db = await connectDb();
  const collection: Collection<Client> = db.collection(COLLECTIONS.CLIENTS);
  return collection.find({}).toArray();
};

const getProjects = async (): Promise<Project[]> => {
  const db = await connectDb();
  const collection: Collection<Project> = db.collection(COLLECTIONS.PROJECTS);
  return collection.find({}).toArray();
};

const getFactsByMonth = async (months: string[]) => {
  const db = await connectDb();
  const collection = db.collection(COLLECTIONS.FACTS_PROJECT_MONTH);
  return collection
    .find({ month: { $in: months } })
    .toArray();
};

const getForecastsByMonth = async (forecastVersionId: string, months: string[]) => {
  const db = await connectDb();
  const collection = db.collection(COLLECTIONS.FORECASTS_PROJECT_MONTH);
  return collection
    .find({ forecast_version_id: forecastVersionId, month: { $in: months } })
    .toArray();
};

const emptyCell = (): PlanFactMonthCell => ({
  fact_rub: 0,
  fact_hours: 0,
  forecast_rub: 0,
  forecast_hours: 0,
});

export const buildPlanFactGrid = async (
  forecastVersionId: string,
  months: string[],
): Promise<PlanFactGridResponse> => {
  const [clients, projects, snapshotMeta, facts, forecasts] = await Promise.all([
    getClients(),
    getProjects(),
    loadCrmSnapshotMeta(),
    getFactsByMonth(months),
    getForecastsByMonth(forecastVersionId, months),
  ]);

  const factsMap = new Map<string, (typeof facts)[number]>();
  facts.forEach((fact) => {
    factsMap.set(`${fact.project_id}__${fact.month}`, fact);
  });
  const forecastsMap = new Map<string, (typeof forecasts)[number]>();
  forecasts.forEach((forecast) => {
    forecastsMap.set(`${forecast.project_id}__${forecast.month}`, forecast);
  });

  const projectsByClient = new Map<string, Project[]>();
  for (const project of projects) {
    if (!projectsByClient.has(project.client_id)) {
      projectsByClient.set(project.client_id, []);
    }
    projectsByClient.get(project.client_id)?.push(project);
  }

  const clientRows: PlanFactClientRow[] = clients.map((client) => {
    const clientProjects = projectsByClient.get(client.client_id) ?? [];

    const projectRows: PlanFactProjectRow[] = clientProjects.map((project) => {
      const monthsMap: Record<string, PlanFactMonthCell> = {};
      months.forEach((month) => {
        const fact = factsMap.get(`${project.project_id}__${month}`);
        const forecast = forecastsMap.get(`${project.project_id}__${month}`);
        const isFix = project.contract_type === 'Fix';
        const factRub = fact?.billed_amount_rub ?? 0;
        const forecastRub = forecast?.forecast_amount_rub ?? 0;
        const fixedRub = isFix ? Math.max(factRub, forecastRub) : 0;

        monthsMap[month] = {
          fact_rub: isFix ? fixedRub : factRub,
          fact_hours: fact?.billed_hours ?? 0,
          forecast_rub: isFix ? fixedRub : forecastRub,
          forecast_hours: forecast?.forecast_hours ?? 0,
          ...(fact?.comment ? { fact_comment: fact.comment } : {}),
          ...(forecast?.comment ? { forecast_comment: forecast.comment } : {}),
        };
      });

      return {
        project_id: project.project_id,
        project_name: project.project_name,
        subproject_name: project.subproject_name,
        contract_type: project.contract_type,
        rate_rub_per_hour: null,
        months: monthsMap,
      };
    });

    const totalsByMonth: Record<string, PlanFactMonthCell> = {};
    months.forEach((month) => {
      totalsByMonth[month] = emptyCell();
    });

    return {
      client_id: client.client_id,
      client_name: client.client_name,
      totals_by_month: totalsByMonth,
      projects: projectRows,
    };
  });

  return {
    snapshot_date: snapshotMeta?.snapshotDate ?? null,
    forecast_version_id: forecastVersionId,
    clients: clientRows,
  };
};

export const upsertFactProjectMonth = async (params: UpsertFactParams) => {
  const db = await connectDb();
  const collection: Collection<FactProjectMonth> = db.collection(COLLECTIONS.FACTS_PROJECT_MONTH);
  const now = new Date();
  const payload: FactProjectMonth = {
    project_id: params.project_id,
    month: params.month,
    type: params.contract_type,
    billed_hours: params.billed_hours,
    billed_amount_rub: params.billed_amount_rub,
    fx_manual_used: false,
    row_version: 1,
    updated_at: now,
    updated_by: 'ui',
    updated_source: 'user',
    comment: params.comment ?? null,
  };
  await collection.updateOne(
    { project_id: params.project_id, month: params.month },
    { $set: payload, $setOnInsert: { project_id: params.project_id, month: params.month } },
    { upsert: true },
  );
  return payload;
};

export const upsertForecastProjectMonth = async (params: UpsertForecastParams) => {
  const db = await connectDb();
  const collection: Collection<ForecastProjectMonth> = db.collection(COLLECTIONS.FORECASTS_PROJECT_MONTH);
  const now = new Date();
  const payload: ForecastProjectMonth = {
    forecast_version_id: params.forecast_version_id,
    project_id: params.project_id,
    month: params.month,
    type: params.contract_type,
    forecast_hours: params.forecast_hours,
    forecast_amount_rub: params.forecast_amount_rub,
    forecast_cost_rub: 0,
    row_version: 1,
    updated_at: now,
    updated_by: 'ui',
    updated_source: 'user',
    comment: params.comment ?? null,
  };
  await collection.updateOne(
    {
      forecast_version_id: params.forecast_version_id,
      project_id: params.project_id,
      month: params.month,
    },
    {
      $set: payload,
      $setOnInsert: {
        forecast_version_id: params.forecast_version_id,
        project_id: params.project_id,
        month: params.month,
      },
    },
    { upsert: true },
  );
  return payload;
};
