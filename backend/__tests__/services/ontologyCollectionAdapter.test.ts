import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { ObjectId } from 'mongodb';
import { tmpdir } from 'os';
import { dirname, resolve } from 'path';

import { resetOntologyCardRegistryForTests } from '../../src/services/ontology/ontologyCardRegistry.js';
import {
  createOntologyMongoCollectionAdapter,
} from '../../src/services/ontology/ontologyCollectionAdapter.js';
import {
  buildOntologyPersistenceBridge,
  resetOntologyPersistenceBridgeForTests,
} from '../../src/services/ontology/ontologyPersistenceBridge.js';

const writeFixture = async (root: string, relativePath: string, contents: string): Promise<void> => {
  const fullPath = resolve(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents, 'utf-8');
};

describe('ontology collection adapter', () => {
  afterEach(() => {
    resetOntologyCardRegistryForTests();
    resetOntologyPersistenceBridgeForTests();
  });

  it('translates ontology attribute payloads into Mongo task documents and back', async () => {
    const adapter = await createOntologyMongoCollectionAdapter('automation_tasks');

    expect(adapter.targetEntity).toBe('task');
    expect(adapter.allowedOntologyAttributes).toEqual(expect.arrayContaining([
      'task_id',
      'title',
      'status',
      'project_id',
      'is_deleted',
    ]));

    const mongoDocument = adapter.toMongoDocument({
      task_id: 'task-1',
      title: 'Implement card-first persistence',
      status: 'DRAFT_10',
      project_id: 'project-1',
      parent_id: 'parent-1',
      is_deleted: false,
    });

    expect(mongoDocument).toEqual({
      _id: 'task-1',
      name: 'Implement card-first persistence',
      task_status: 'DRAFT_10',
      project_id: 'project-1',
      parent_id: 'parent-1',
      is_deleted: false,
    });

    expect(adapter.fromMongoDocument(mongoDocument)).toEqual({
      task_id: 'task-1',
      title: 'Implement card-first persistence',
      status: 'DRAFT_10',
      project_id: 'project-1',
      parent_id: 'parent-1',
      is_deleted: false,
    });
  });

  it('builds Mongo soft-delete patches for card-backed collections exposing is_deleted', async () => {
    const adapter = await createOntologyMongoCollectionAdapter('automation_tasks');

    expect(
      adapter.buildSoftDeleteMongoUpdate({
        deleted_at: '2026-03-25T12:00:00Z',
        updated_at: '2026-03-25T12:00:00Z',
      })
    ).toEqual({
      $set: {
        is_deleted: true,
        deleted_at: '2026-03-25T12:00:00Z',
        updated_at: '2026-03-25T12:00:00Z',
      },
    });
  });

  it('validates scalar Mongo fields against card-derived value types and enum domains', async () => {
    const adapter = await createOntologyMongoCollectionAdapter('automation_tasks');

    expect(() =>
      adapter.assertValidMongoDocument({
        name: 'Implement card-first persistence',
        priority: 'P3',
        parent_id: 'parent-1',
        project_id: 'project-1',
        source_kind: 'voice_possible_task',
        dialogue_tag: 'voice',
        status_update_checked: false,
        is_deleted: false,
        created_at: new Date('2026-03-25T12:00:00.000Z'),
        updated_at: new Date('2026-03-25T12:00:00.000Z'),
      })
    ).not.toThrow();

    expect(() =>
      adapter.assertValidMongoDocument({
        source_kind: 'invalid-source-kind',
      })
    ).toThrow(/violates enum domain/);

    expect(() =>
      adapter.assertValidMongoDocument({
        priority: 'P9',
      })
    ).toThrow(/violates enum domain/);

    expect(() =>
      adapter.assertValidMongoDocument({
        status_update_checked: 'false',
      } as unknown as Record<string, unknown>)
    ).toThrow(/violates boolean type/);
  });

  it('rejects strict adapters for schema-only unchecked collections', async () => {
    await expect(
      createOntologyMongoCollectionAdapter('automation_voice_bot_sessions')
    ).rejects.toThrow(/without card-backed coverage/);
  });

  it('fails fast on ambiguous reverse Mongo mappings', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ontology-collection-adapter-dup-'));
    try {
      await writeFixture(root, 'schema/10-task.tql', `
# --- <semantic-card id="task"> ---
# kind: entity
entity task,
  owns task_id,
  owns priority,
  owns priority_rank;
# --- </semantic-card> ---
`);
      await writeFixture(root, 'mongodb_to_typedb_v1.yaml', `
collections:
  - collection: automation_tasks
    target_entity: task
    key:
      attribute: task_id
      from: _id
    attributes:
      priority: priority
      priority_rank: priority
`);

      process.env.ONTOLOGY_TQL_FRAGMENTS_ROOT = resolve(root, 'schema');
      const bridge = await buildOntologyPersistenceBridge(resolve(root, 'mongodb_to_typedb_v1.yaml'));

      await expect(
        createOntologyMongoCollectionAdapter('automation_tasks', bridge)
      ).rejects.toThrow(/maps multiple ontology attrs to Mongo field priority/);
    } finally {
      delete process.env.ONTOLOGY_TQL_FRAGMENTS_ROOT;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows ObjectId key fields and explicitly deferred structured string fields in validated subsets', async () => {
    const adapter = await createOntologyMongoCollectionAdapter('automation_tasks');

    expect(() =>
      adapter.assertValidMongoDocument({
        _id: new ObjectId(),
        source_data: { session_id: 'session-1' },
      }, {
        validatedMongoFields: ['_id', 'source_data'],
        allowedMongoStructuredStringFields: ['source_data'],
      })
    ).not.toThrow();
  });
});
