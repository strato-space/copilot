import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import YAML from 'yaml';

import {
  getOntologyCardRegistry,
  loadOntologyCardRegistry,
  OntologyCardRegistryError,
} from './ontologyCardRegistry.js';
import type { OntologyCardRegistry } from './ontologyCardRegistry.js';

const resolveDefaultMappingPath = (): string => {
  const candidates = [
    resolve(process.cwd(), '../ontology/typedb/mappings/mongodb_to_typedb_v1.yaml'),
    resolve(process.cwd(), 'ontology/typedb/mappings/mongodb_to_typedb_v1.yaml'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? candidates[1]!;
};

const DEFAULT_MAPPING_PATH = resolveDefaultMappingPath();

interface RawMappingCollection {
  collection: string;
  target_entity: string;
  key: {
    attribute: string;
    from: string;
  };
  attributes?: Record<string, string>;
}

interface RawMappingFile {
  collections?: RawMappingCollection[];
}

export type OntologyPersistenceBridgeStatus = 'card-backed' | 'schema-only-unchecked';

export interface OntologyCollectionBridgeEntry {
  collection: string;
  targetEntity: string;
  status: OntologyPersistenceBridgeStatus;
  keyAttribute: string;
  keySourceField: string;
  mongoToOntologyAttributes: Record<string, string>;
  checkedAttributes: string[];
  uncheckedAttributes: string[];
  cardId: string | null;
}

export interface OntologyPersistenceBridge {
  mappingPath: string;
  registryHash: string;
  collectionCount: number;
  cardBackedCollections: number;
  schemaOnlyCollections: number;
  collections: Record<string, OntologyCollectionBridgeEntry>;
}

let cachedBridge: OntologyPersistenceBridge | null = null;

const parseMappingFile = async (mappingPath: string): Promise<RawMappingFile> => {
  const text = await readFile(mappingPath, 'utf-8');
  const parsed = YAML.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OntologyCardRegistryError(`[ontology-persistence-bridge] invalid mapping file: ${mappingPath}`);
  }
  return parsed as RawMappingFile;
};

const buildEntry = (
  raw: RawMappingCollection,
  registry: OntologyCardRegistry
): OntologyCollectionBridgeEntry => {
  const card = Object.values(registry.cards).find((entry) => entry.label === raw.target_entity) ?? null;
  const mongoToOntologyAttributes = raw.attributes ?? {};
  const ontologyAttributes = [raw.key.attribute, ...Object.keys(mongoToOntologyAttributes)];

  if (!card) {
    return {
      collection: raw.collection,
      targetEntity: raw.target_entity,
      status: 'schema-only-unchecked',
      keyAttribute: raw.key.attribute,
      keySourceField: raw.key.from,
      mongoToOntologyAttributes,
      checkedAttributes: [],
      uncheckedAttributes: ontologyAttributes,
      cardId: null,
    };
  }

  const missing = ontologyAttributes.filter((attribute) => !card.effectiveOwns.includes(attribute));
  if (missing.length > 0) {
    throw new OntologyCardRegistryError(
      `[ontology-persistence-bridge] mapping ${raw.collection} -> ${raw.target_entity} references attrs missing from card ${card.id}: ${missing.join(', ')}`
    );
  }

  return {
    collection: raw.collection,
    targetEntity: raw.target_entity,
    status: 'card-backed',
    keyAttribute: raw.key.attribute,
    keySourceField: raw.key.from,
    mongoToOntologyAttributes,
    checkedAttributes: ontologyAttributes,
    uncheckedAttributes: [],
    cardId: card.id,
  };
};

export const buildOntologyPersistenceBridge = async (
  mappingPath: string = process.env.ONTOLOGY_MONGODB_TYPEDB_MAPPING_PATH ?? DEFAULT_MAPPING_PATH
): Promise<OntologyPersistenceBridge> => {
  const registry = await loadOntologyCardRegistry();
  const mapping = await parseMappingFile(mappingPath);
  const rawCollections = mapping.collections ?? [];
  const entries = rawCollections.map((raw) => buildEntry(raw, registry));
  const collections = Object.fromEntries(entries.map((entry) => [entry.collection, entry]));
  const cardBackedCollections = entries.filter((entry) => entry.status === 'card-backed').length;
  const schemaOnlyCollections = entries.filter((entry) => entry.status === 'schema-only-unchecked').length;

  return {
    mappingPath,
    registryHash: registry.registryHash,
    collectionCount: entries.length,
    cardBackedCollections,
    schemaOnlyCollections,
    collections,
  };
};

export const loadOntologyPersistenceBridge = async (
  mappingPath?: string
): Promise<OntologyPersistenceBridge> => {
  if (cachedBridge) return cachedBridge;
  cachedBridge = await buildOntologyPersistenceBridge(mappingPath);
  return cachedBridge;
};

export const getOntologyPersistenceBridge = (): OntologyPersistenceBridge => {
  void getOntologyCardRegistry();
  if (!cachedBridge) {
    throw new OntologyCardRegistryError(
      'Ontology persistence bridge not initialized. Call loadOntologyPersistenceBridge() first.'
    );
  }
  return cachedBridge;
};

export const resetOntologyPersistenceBridgeForTests = (): void => {
  cachedBridge = null;
};
