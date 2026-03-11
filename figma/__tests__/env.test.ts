import { readEnv, resetEnvForTests } from '../src/config/env.js';

describe('readEnv', () => {
  afterEach(() => {
    resetEnvForTests();
  });

  it('parses csv, booleans and numeric defaults', () => {
    const env = readEnv({
      APP_ENV: 'dev',
      MONGODB_CONNECTION_STRING: 'mongodb://localhost:27017',
      DB_NAME: 'copilot',
      FIGMA_TEAM_IDS: 'team-1, team-2 ,, team-3',
      FIGMA_INCLUDE_BRANCHES: 'true',
      FIGMA_FILE_TREE_DEPTH: '4',
      REDIS_CONNECTION_HOST: '127.0.0.1',
      REDIS_CONNECTION_PORT: '6380',
      REDIS_DB_INDEX: '3',
    });

    expect(env.appEnv).toBe('dev');
    expect(env.figmaTeamIds).toEqual(['team-1', 'team-2', 'team-3']);
    expect(env.figmaIncludeBranches).toBe(true);
    expect(env.figmaFileTreeDepth).toBe(4);
    expect(env.redisPort).toBe(6380);
    expect(env.redisDbIndex).toBe(3);
    expect(env.figmaRetryMaxAttempts).toBe(4);
  });
});
