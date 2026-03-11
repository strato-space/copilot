import { connectMongo, closeMongo } from '../db/mongo.js';
import { closeRedis, connectRedis } from '../redis/connection.js';
import { collectIndexerStats, startIndexerRuntime } from '../services/indexerRuntime.js';
import { startWebhookRuntime } from '../services/webhookRuntime.js';
import { getEnv } from '../config/env.js';
import { upsertSeedTeams } from '../domain/teams.js';
import { handleSyncFileTree } from '../jobs/handlers/syncFileTree.js';
import { handleSyncFilesForProject } from '../jobs/handlers/syncProjectFiles.js';
import { handleSyncProjectsForTeam } from '../jobs/handlers/syncProjects.js';

const parseArg = (name: string): string | null => {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
};

const command = process.argv[2];

const withRuntime = async <T>(fn: () => Promise<T>): Promise<T> => {
  await connectMongo();
  connectRedis();
  try {
    return await fn();
  } finally {
    await closeMongo();
    await closeRedis();
  }
};

const main = async (): Promise<void> => {
  switch (command) {
    case 'serve:indexer': {
      await startIndexerRuntime();
      return;
    }
    case 'serve:webhooks': {
      await startWebhookRuntime();
      return;
    }
    case 'sync:bootstrap': {
      await withRuntime(async () => {
        const env = getEnv();
        await upsertSeedTeams(env.figmaTeamIds);
        for (const teamId of env.figmaTeamIds) {
          await handleSyncProjectsForTeam({ team_id: teamId, trigger: 'manual' });
        }
      });
      return;
    }
    case 'sync:team': {
      const teamId = parseArg('team');
      if (!teamId) {
        throw new Error('team flag required: --team=<id>');
      }
      await withRuntime(async () => {
        await handleSyncProjectsForTeam({ team_id: teamId, trigger: 'manual' });
      });
      return;
    }
    case 'sync:project': {
      const projectId = parseArg('project');
      const teamId = parseArg('team');
      if (!projectId || !teamId) {
        throw new Error('project and team flags required: --project=<id> --team=<id>');
      }
      await withRuntime(async () => {
        await handleSyncFilesForProject({ project_id: projectId, team_id: teamId, trigger: 'manual' });
      });
      return;
    }
    case 'sync:file': {
      const fileKey = parseArg('file');
      const projectId = parseArg('project');
      const teamId = parseArg('team');
      if (!fileKey || !projectId || !teamId) {
        throw new Error('file, project and team flags required: --file=<key> --project=<id> --team=<id>');
      }
      await withRuntime(async () => {
        await handleSyncFileTree({
          file_key: fileKey,
          project_id: projectId,
          team_id: teamId,
          reason: 'manual',
          source: 'manual',
        });
      });
      return;
    }
    case 'stats': {
      const stats = await withRuntime(async () => collectIndexerStats());
      process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
      return;
    }
    default:
      process.stdout.write(
        [
          'Usage:',
          '  tsx src/cli/index.ts serve:indexer',
          '  tsx src/cli/index.ts serve:webhooks',
          '  tsx src/cli/index.ts sync:bootstrap',
          '  tsx src/cli/index.ts sync:team --team=<id>',
          '  tsx src/cli/index.ts sync:project --team=<id> --project=<id>',
          '  tsx src/cli/index.ts sync:file --team=<id> --project=<id> --file=<key>',
          '  tsx src/cli/index.ts stats',
        ].join('\n')
      );
      process.exitCode = 1;
  }
};

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
