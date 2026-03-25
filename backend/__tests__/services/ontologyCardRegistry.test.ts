import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, resolve } from 'path';

import {
  buildOntologyCardRegistry,
  resetOntologyCardRegistryForTests,
} from '../../src/services/ontology/ontologyCardRegistry.js';

const REAL_FRAGMENTS_ROOT = resolve(process.cwd(), '../ontology/typedb/schema/fragments');

const writeFixture = async (root: string, relativePath: string, contents: string): Promise<void> => {
  const fullPath = resolve(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents, 'utf-8');
};

describe('ontology card registry', () => {
  afterEach(() => {
    resetOntologyCardRegistryForTests();
  });

  it('parses the current annotated TQL fragments into a registry', async () => {
    const registry = await buildOntologyCardRegistry(REAL_FRAGMENTS_ROOT);

    expect(registry.cardCount).toBeGreaterThan(50);
    expect(registry.registryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(registry.cards.artifact_record).toEqual(expect.objectContaining({
      id: 'artifact_record',
      label: 'artifact_record',
      definitionKind: 'entity',
      metadata: expect.objectContaining({
        kind: 'semantic-artifact',
        scope: 'BC.ArtifactWorld',
      }),
    }));
    expect(registry.cards.task_classified_as_task_family).toEqual(expect.objectContaining({
      id: 'task_classified_as_task_family',
      label: 'task_classified_as_task_family',
      definitionKind: 'relation',
      relates: expect.arrayContaining(['task', 'task_family']),
    }));
    expect(registry.cards.change_proposal).toEqual(expect.objectContaining({
      id: 'change_proposal',
      label: 'change_proposal',
      definitionKind: 'entity',
    }));
    expect(registry.attributes.status).toEqual(expect.objectContaining({
      label: 'status',
      valueType: 'string',
    }));
    expect(registry.cards.task.effectiveOwnAttributeSpecs.status).toEqual(expect.objectContaining({
      label: 'status',
      valueType: 'string',
      enumValues: expect.arrayContaining(['DRAFT_10', 'READY_10', 'DONE_10']),
    }));
  });

  it('fails on duplicate semantic-card ids', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ontology-card-registry-dup-'));
    try {
      await writeFixture(root, '10-as-is/10-first.tql', `
# --- <semantic-card id="duplicate_card"> ---
# kind: test
entity first_entity,
  owns name;
# --- </semantic-card> ---
`);
      await writeFixture(root, '20-to-be/20-second.tql', `
# --- <semantic-card id="duplicate_card"> ---
# kind: test
entity second_entity,
  owns name;
# --- </semantic-card> ---
`);

      await expect(buildOntologyCardRegistry(root)).rejects.toThrow(
        /duplicate semantic-card id "duplicate_card"/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails on nested semantic-card openings before closing the current card', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ontology-card-registry-nested-'));
    try {
      await writeFixture(root, '20-to-be/10-invalid.tql', `
# --- <semantic-card id="outer_card"> ---
# kind: test
# --- <semantic-card id="inner_card"> ---
entity invalid_entity,
  owns name;
# --- </semantic-card> ---
`);

      await expect(buildOntologyCardRegistry(root)).rejects.toThrow(
        '[ontology-card-registry] nested semantic-card start before closing outer_card'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves inherited owns by supertype label even when card id differs from label', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ontology-card-registry-inherit-'));
    try {
      await writeFixture(root, '20-to-be/10-inheritance.tql', `
# --- <semantic-card id="task_base_card"> ---
# kind: test
entity task_base,
  owns inherited_attr;
# --- </semantic-card> ---

# --- <semantic-card id="task_specialized_card"> ---
# kind: test
entity task_specialized sub task_base,
  owns local_attr;
# --- </semantic-card> ---
`);

      const registry = await buildOntologyCardRegistry(root);
      expect(registry.cards.task_specialized_card?.effectiveOwns).toEqual(
        expect.arrayContaining(['inherited_attr', 'local_attr'])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
