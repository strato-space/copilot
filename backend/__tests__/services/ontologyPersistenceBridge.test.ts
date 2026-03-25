import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, resolve } from 'path';

import { resetOntologyCardRegistryForTests } from '../../src/services/ontology/ontologyCardRegistry.js';
import {
  buildOntologyPersistenceBridge,
  resetOntologyPersistenceBridgeForTests,
} from '../../src/services/ontology/ontologyPersistenceBridge.js';

const writeFixture = async (root: string, relativePath: string, contents: string): Promise<void> => {
  const fullPath = resolve(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents, 'utf-8');
};

describe('ontology persistence bridge', () => {
  afterEach(() => {
    resetOntologyCardRegistryForTests();
    resetOntologyPersistenceBridgeForTests();
    delete process.env.ONTOLOGY_TQL_FRAGMENTS_ROOT;
  });

  it('loads the current MongoDB mapping and classifies card-backed coverage', async () => {
    const bridge = await buildOntologyPersistenceBridge(
      resolve(process.cwd(), '../ontology/typedb/mappings/mongodb_to_typedb_v1.yaml')
    );

    expect(bridge.collectionCount).toBeGreaterThan(20);
    expect(bridge.cardBackedCollections).toBeGreaterThan(10);
    expect(bridge.schemaOnlyCollections).toBeGreaterThan(10);
    expect(bridge.collections.automation_tasks).toEqual(expect.objectContaining({
      collection: 'automation_tasks',
      targetEntity: 'task',
      status: 'card-backed',
      keyAttribute: 'task_id',
      cardId: 'task',
    }));
    expect(bridge.collections.automation_voice_bot_sessions).toEqual(expect.objectContaining({
      collection: 'automation_voice_bot_sessions',
      targetEntity: 'voice_session',
      status: 'schema-only-unchecked',
      uncheckedAttributes: expect.arrayContaining(['voice_session_id', 'project_id']),
    }));
    expect(bridge.collections.automation_visual_observations).toEqual(expect.objectContaining({
      collection: 'automation_visual_observations',
      targetEntity: 'visual_observation',
      status: 'card-backed',
      keyAttribute: 'evidence_observation_id',
      checkedAttributes: expect.arrayContaining(['evidence_observation_id', 'observation_type']),
    }));
  });

  it('fails when a card-backed mapping references an attribute outside the card effective owns', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ontology-persistence-bridge-'));
    try {
      await writeFixture(root, '20-to-be/10-carded.tql', `
# --- <semantic-card id="test_entity"> ---
# kind: test
entity test_entity,
  owns test_entity_id @key,
  owns allowed_attr;
# --- </semantic-card> ---
`);
      const mappingPath = resolve(root, 'mapping.yaml');
      await writeFile(mappingPath, `
collections:
  - collection: test_collection
    target_entity: test_entity
    key:
      attribute: test_entity_id
      from: _id
    attributes:
      forbidden_attr: forbidden_field
`, 'utf-8');
      process.env.ONTOLOGY_TQL_FRAGMENTS_ROOT = root;

      await expect(buildOntologyPersistenceBridge(mappingPath)).rejects.toThrow(
        /references attrs missing from card test_entity: forbidden_attr/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
