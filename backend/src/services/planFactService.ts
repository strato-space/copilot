import { type Collection } from 'mongodb';
import { connectDb } from './db.js';
import { COLLECTIONS } from '../models/collections.js';
import { type Client, type Project } from '../models/types.js';
import { loadCrmSnapshotMeta } from './crmIngest.js';

export interface PlanFactMonthCell {
  fact_rub: number;
  fact_hours: number;
  forecast_rub: number;
  forecast_hours: number;
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
  const [clients, projects, snapshotMeta] = await Promise.all([
    getClients(),
    getProjects(),
    loadCrmSnapshotMeta(),
  ]);

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
        monthsMap[month] = emptyCell();
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
