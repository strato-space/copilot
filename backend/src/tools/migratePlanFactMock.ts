import { connectDb, closeDb, getDb } from '../services/db.js';
import type { Collection, Document, OptionalUnlessRequiredId } from 'mongodb';
import { COLLECTIONS } from '../constants.js';

interface MockMonthCell {
    fact_rub: number;
    fact_hours: number;
    forecast_rub: number;
    forecast_hours: number;
}

interface MockProject {
    client_id: string;
    client_name: string;
    project_id: string;
    project_name: string;
    subproject_name: string;
    contract_type: 'T&M' | 'Fix';
    rate_rub_per_hour: number | null;
    months: Record<string, MockMonthCell>;
}

interface MockPlanFact {
    snapshot_date: string;
    forecast_version_id: string;
    projects: MockProject[];
}

const mockPlanFact: MockPlanFact = {
    snapshot_date: '2026-01-22T09:00:00+03:00',
    forecast_version_id: 'baseline',
    projects: [
        {
            client_id: '68ba5f850994efca4d903c78',
            client_name: 'DBI',
            project_id: '672315cb537994d86e1c68be',
            project_name: 'Metro Spot',
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
            client_id: '68ba5f850994efca4d903c78',
            client_name: 'DBI',
            project_id: '682b08b23ec4f1a7f2f3998b',
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
            client_id: '68ba5f850994efca4d903c78',
            client_name: 'DBI',
            project_id: '6809faae30d84c45aa1a168f',
            project_name: 'Metro MAPS',
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
            client_id: '68ba5f850994efca4d903c78',
            client_name: 'DBI',
            project_id: '672315cb537994d86e1c68bf',
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
            client_id: '68ba5f850994efca4d903c78',
            client_name: 'DBI',
            project_id: '6981b223ccb993fded944b72',
            project_name: 'Metro PICK',
            subproject_name: '',
            contract_type: 'T&M',
            rate_rub_per_hour: 1700,
            months: {
                '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
                '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 150 },
                '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 0 },
            },
        },
        // {
        //     client_id: '68ba5f850994efca4d903c78',
        //     client_name: 'DBI',
        //     project_id: 'p-dbi-metro-supliersup',
        //     project_name: 'Metro SuplierSup',
        //     subproject_name: '',
        //     contract_type: 'T&M',
        //     rate_rub_per_hour: 1700,
        //     months: {
        //         '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 0, forecast_hours: 0 },
        //         '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 150 },
        //         '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 0 },
        //     },
        // },
        {
            client_id: '68ba5f850994efca4d903c78',
            client_name: 'DBI',
            project_id: '6865fae618fb3e43aafbc29a',
            project_name: 'Ural BortProvodnik',
            subproject_name: '',
            contract_type: 'T&M',
            rate_rub_per_hour: 1700,
            months: {
                '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 340000, forecast_hours: 200 },
                '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 150 },
                '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 255000, forecast_hours: 0 },
            },
        },
        {
            client_id: '672315cb537994d86e1c68a5',
            client_name: '1x',
            project_id: '683ed1012e8505e511939544',
            project_name: '1XBet',
            subproject_name: '',
            contract_type: 'Fix',
            rate_rub_per_hour: 937,
            months: {
                '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
                '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
                '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 75000, forecast_hours: 0 },
            },
        },
        {
            client_id: '6863b53ba6d7b324e2df3104',
            client_name: 'Sha',
            project_id: '6863b60f18fb3e43aafbc278',
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
            client_id: '6863b53ba6d7b324e2df3104',
            client_name: 'Sha',
            project_id: '6926caec34968b218a7f85ed',
            project_name: 'RockStar Hearts',
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
            client_id: '6863b53ba6d7b324e2df3104',
            client_name: 'Sha',
            project_id: '6761087b2b049817faa659e6',
            project_name: 'SportDay',
            subproject_name: '',
            contract_type: 'T&M',
            rate_rub_per_hour: 1400,
            months: {
                '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 67200, forecast_hours: 48 },
                '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 100000, forecast_hours: 60 },
                '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 100000, forecast_hours: 0 },
            },
        },
        {
            client_id: '691b10c434968b218a7f85af',
            client_name: 'EZO',
            project_id: '691b129734968b218a7f85b3',
            project_name: 'EZOCRM',
            subproject_name: '',
            contract_type: 'T&M',
            rate_rub_per_hour: 1700,
            months: {
                '2026-01': { fact_rub: 0, fact_hours: 0, forecast_rub: 95200, forecast_hours: 56 },
                '2026-02': { fact_rub: 0, fact_hours: 0, forecast_rub: 238000, forecast_hours: 140 },
                '2026-03': { fact_rub: 0, fact_hours: 0, forecast_rub: 238000, forecast_hours: 0 },
            },
        },
        {
            client_id: '6968cccd07c864fc085ce908',
            client_name: 'Titan',
            project_id: '6968cf0b07c864fc085ce90d',
            project_name: 'T2 Mobile',
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
};

const DRY_RUN = process.argv.includes('--dry-run');
const MIGRATION_USER = 'planfact-migration';

const insertOneSafe = async <T extends Document>(
    collection: Collection<T>,
    doc: OptionalUnlessRequiredId<T>,
): Promise<boolean> => {
    if (DRY_RUN) {
        return true;
    }
    try {
        await collection.insertOne(doc);
        return true;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000) {
            return false;
        }
        throw error;
    }
};

const insertForecasts = async (projects: MockProject[], forecastVersionId: string): Promise<number> => {
    const collection = getDb().collection(COLLECTIONS.FORECASTS_PROJECT_MONTH);
    let count = 0;
    for (const project of projects) {
        for (const [month, cell] of Object.entries(project.months)) {
            if (!cell.forecast_rub && !cell.forecast_hours) {
                continue;
            }
            const doc = {
                forecast_version_id: forecastVersionId,
                project_id: project.project_id,
                month,
                type: project.contract_type,
                forecast_hours: cell.forecast_hours,
                forecast_amount_rub: cell.forecast_rub,
                forecast_cost_rub: 0,
                comment: null,
                row_version: 1,
                updated_at: new Date(),
                updated_by: MIGRATION_USER,
                updated_source: 'system',
            };
            if (await insertOneSafe(collection, doc)) {
                count += 1;
            }
        }
    }
    return count;
};

const insertFacts = async (projects: MockProject[]): Promise<number> => {
    const collection = getDb().collection(COLLECTIONS.FACTS_PROJECT_MONTH);
    let count = 0;
    for (const project of projects) {
        for (const [month, cell] of Object.entries(project.months)) {
            if (!cell.fact_rub && !cell.fact_hours) {
                continue;
            }
            const doc = {
                project_id: project.project_id,
                month,
                type: project.contract_type,
                billed_hours: cell.fact_hours,
                billed_amount_rub: cell.fact_rub,
                fx_manual_used: false,
                row_version: 1,
                updated_at: new Date(),
                updated_by: MIGRATION_USER,
                updated_source: 'system',
                comment: null,
            };
            if (await insertOneSafe(collection, doc)) {
                count += 1;
            }
        }
    }
    return count;
};

const run = async (): Promise<void> => {
    console.log(`PlanFact mock migration ${DRY_RUN ? '(dry-run)' : ''}`);
    await connectDb();

    const customersCollection = getDb().collection<{ _id: string }>(COLLECTIONS.CUSTOMERS);
    const projectsCollection = getDb().collection<{ _id: string }>(COLLECTIONS.PROJECTS);
    const existingCustomers = new Set(
        (await customersCollection.find({}, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id),
    );
    const existingProjects = new Set(
        (await projectsCollection.find({}, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id),
    );
    const eligibleProjects = mockPlanFact.projects.filter(
        (project) => existingCustomers.has(project.client_id) && existingProjects.has(project.project_id),
    );
    const skippedProjects = mockPlanFact.projects.filter(
        (project) => !existingCustomers.has(project.client_id) || !existingProjects.has(project.project_id),
    );
    const forecasts = await insertForecasts(eligibleProjects, mockPlanFact.forecast_version_id);
    const facts = await insertFacts(eligibleProjects);

    console.log('Summary:');
    console.log(`- Forecast rows inserted: ${forecasts}`);
    console.log(`- Fact rows inserted: ${facts}`);
    console.log(`- Projects skipped (missing client/project): ${skippedProjects.length}`);

    await closeDb();
};

run().catch(async (error) => {
    console.error('Migration failed:', error);
    await closeDb();
    process.exit(1);
});
