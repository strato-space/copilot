import { ObjectId } from 'mongodb';
import {
  getOntologyPersistenceBridge,
  loadOntologyPersistenceBridge,
} from './ontologyPersistenceBridge.js';
import type {
  OntologyCollectionBridgeEntry,
  OntologyPersistenceBridge,
} from './ontologyPersistenceBridge.js';
import {
  getOntologyCardRegistry,
  loadOntologyCardRegistry,
  OntologyCardRegistryError,
} from './ontologyCardRegistry.js';
import type { OntologyCardRegistry, OntologyOwnedAttributeSpec } from './ontologyCardRegistry.js';

export interface OntologyCollectionValidationOptions {
  allowedMongoStructuredStringFields?: string[];
  validatedMongoFields?: string[];
}

export interface OntologyMongoCollectionAdapter {
  collection: string;
  targetEntity: string;
  keyAttribute: string;
  keySourceField: string;
  allowedOntologyAttributes: string[];
  allowedMongoFields: string[];
  toMongoDocument(payload: Record<string, unknown>): Record<string, unknown>;
  fromMongoDocument(document: Record<string, unknown>): Record<string, unknown>;
  assertValidMongoDocument(document: Record<string, unknown>, options?: OntologyCollectionValidationOptions): void;
  buildSoftDeleteMongoUpdate(extraFields?: Record<string, unknown>): { $set: Record<string, unknown> };
}

const invertAttributeMap = (entry: OntologyCollectionBridgeEntry): Record<string, string> => {
  const mongoToOntology: Record<string, string> = {
    [entry.keySourceField]: entry.keyAttribute,
  };
  for (const [ontologyAttribute, mongoField] of Object.entries(entry.mongoToOntologyAttributes)) {
    const existing = mongoToOntology[mongoField];
    if (existing && existing !== ontologyAttribute) {
      throw new OntologyCardRegistryError(
        `[ontology-collection-adapter] collection ${entry.collection} maps multiple ontology attrs to Mongo field ${mongoField}: ${existing}, ${ontologyAttribute}`
      );
    }
    mongoToOntology[mongoField] = ontologyAttribute;
  }
  return mongoToOntology;
};

const buildOntologyToMongoMap = (entry: OntologyCollectionBridgeEntry): Record<string, string> => ({
  [entry.keyAttribute]: entry.keySourceField,
  ...entry.mongoToOntologyAttributes,
});

const assertCardBackedEntry = (entry: OntologyCollectionBridgeEntry): void => {
  if (entry.status !== 'card-backed') {
    throw new OntologyCardRegistryError(
      `[ontology-collection-adapter] collection ${entry.collection} targets ${entry.targetEntity} without card-backed coverage`
    );
  }
};

const assertAllowedKeys = (
  space: 'ontology' | 'mongo',
  providedKeys: string[],
  allowedKeys: string[],
  context: string
): void => {
  const allowed = new Set(allowedKeys);
  const unknown = providedKeys.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new OntologyCardRegistryError(
      `[ontology-collection-adapter] ${context} contains unknown ${space} keys: ${unknown.join(', ')}`
    );
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof ObjectId);

const isValidDateLike = (value: unknown): boolean => {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string') return false;
  return !Number.isNaN(Date.parse(value));
};

const assertValueAgainstSpec = ({
  collection,
  field,
  value,
  spec,
  keyMongoField,
  mongoField,
  allowedMongoStructuredStringFields,
}: {
  collection: string;
  field: string;
  value: unknown;
  spec: OntologyOwnedAttributeSpec;
  keyMongoField: string;
  mongoField: string;
  allowedMongoStructuredStringFields: Set<string>;
}): void => {
  if (value == null) return;

  const allowStructuredString =
    spec.valueType === 'string' &&
    allowedMongoStructuredStringFields.has(mongoField) &&
    (Array.isArray(value) || isPlainObject(value));

  if (!allowStructuredString) {
    switch (spec.valueType) {
      case 'string':
        if (!(typeof value === 'string' || (mongoField === keyMongoField && value instanceof ObjectId))) {
          throw new OntologyCardRegistryError(
            `[ontology-collection-adapter] collection ${collection} field ${mongoField} violates string type for ontology attr ${field}`
          );
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new OntologyCardRegistryError(
            `[ontology-collection-adapter] collection ${collection} field ${mongoField} violates boolean type for ontology attr ${field}`
          );
        }
        break;
      case 'double':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new OntologyCardRegistryError(
            `[ontology-collection-adapter] collection ${collection} field ${mongoField} violates double type for ontology attr ${field}`
          );
        }
        break;
      case 'long':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          throw new OntologyCardRegistryError(
            `[ontology-collection-adapter] collection ${collection} field ${mongoField} violates long type for ontology attr ${field}`
          );
        }
        break;
      case 'datetime':
        if (!isValidDateLike(value)) {
          throw new OntologyCardRegistryError(
            `[ontology-collection-adapter] collection ${collection} field ${mongoField} violates datetime type for ontology attr ${field}`
          );
        }
        break;
      default:
        break;
    }
  }

  if (spec.enumValues.length > 0 && typeof value === 'string' && !spec.enumValues.includes(value)) {
    throw new OntologyCardRegistryError(
      `[ontology-collection-adapter] collection ${collection} field ${mongoField} violates enum domain for ontology attr ${field}: ${value}`
    );
  }
};

const createAdapterFromEntry = (
  entry: OntologyCollectionBridgeEntry,
  registry: OntologyCardRegistry
): OntologyMongoCollectionAdapter => {
  assertCardBackedEntry(entry);
  const ontologyToMongo = buildOntologyToMongoMap(entry);
  const mongoToOntology = invertAttributeMap(entry);
  const allowedOntologyAttributes = Object.keys(ontologyToMongo).sort();
  const allowedMongoFields = Object.keys(mongoToOntology).sort();
  const card = entry.cardId ? registry.cards[entry.cardId] ?? null : null;
  if (!card) {
    throw new OntologyCardRegistryError(
      `[ontology-collection-adapter] collection ${entry.collection} is card-backed but card ${entry.cardId ?? '<missing>'} is unavailable`
    );
  }

  return {
    collection: entry.collection,
    targetEntity: entry.targetEntity,
    keyAttribute: entry.keyAttribute,
    keySourceField: entry.keySourceField,
    allowedOntologyAttributes,
    allowedMongoFields,
    toMongoDocument(payload: Record<string, unknown>): Record<string, unknown> {
      const keys = Object.keys(payload);
      assertAllowedKeys('ontology', keys, allowedOntologyAttributes, `${entry.collection}.toMongoDocument(payload)`);

      const mongoDocument: Record<string, unknown> = {};
      for (const [ontologyAttribute, value] of Object.entries(payload)) {
        const mongoField = ontologyToMongo[ontologyAttribute];
        if (!mongoField) {
          throw new OntologyCardRegistryError(
            `[ontology-collection-adapter] no Mongo field mapping for ontology attribute ${ontologyAttribute} in ${entry.collection}`
          );
        }
        mongoDocument[mongoField] = value;
      }
      return mongoDocument;
    },
    fromMongoDocument(document: Record<string, unknown>): Record<string, unknown> {
      const keys = Object.keys(document);
      assertAllowedKeys('mongo', keys, allowedMongoFields, `${entry.collection}.fromMongoDocument(document)`);

      const ontologyDocument: Record<string, unknown> = {};
      for (const [mongoField, value] of Object.entries(document)) {
        const ontologyAttribute = mongoToOntology[mongoField];
        if (!ontologyAttribute) {
          throw new OntologyCardRegistryError(
            `[ontology-collection-adapter] no ontology attribute mapping for Mongo field ${mongoField} in ${entry.collection}`
          );
        }
        ontologyDocument[ontologyAttribute] = value;
      }
      return ontologyDocument;
    },
    assertValidMongoDocument(
      document: Record<string, unknown>,
      options: OntologyCollectionValidationOptions = {}
    ): void {
      const keys = Object.keys(document);
      assertAllowedKeys('mongo', keys, allowedMongoFields, `${entry.collection}.assertValidMongoDocument(document)`);

      const allowedStructuredStringFields = new Set(options.allowedMongoStructuredStringFields ?? []);
      const validatedMongoFields = options.validatedMongoFields
        ? new Set(options.validatedMongoFields)
        : null;
      for (const [mongoField, value] of Object.entries(document)) {
        if (validatedMongoFields && !validatedMongoFields.has(mongoField)) continue;
        const ontologyAttribute = mongoToOntology[mongoField];
        if (!ontologyAttribute) {
          throw new OntologyCardRegistryError(
            `[ontology-collection-adapter] no ontology attribute mapping for Mongo field ${mongoField} in ${entry.collection}`
          );
        }
        const spec = card.effectiveOwnAttributeSpecs[ontologyAttribute];
        if (!spec) continue;
        assertValueAgainstSpec({
          collection: entry.collection,
          field: ontologyAttribute,
          value,
          spec,
          keyMongoField: entry.keySourceField,
          mongoField,
          allowedMongoStructuredStringFields: allowedStructuredStringFields,
        });
      }
    },
    buildSoftDeleteMongoUpdate(extraFields: Record<string, unknown> = {}): { $set: Record<string, unknown> } {
      if (!allowedOntologyAttributes.includes('is_deleted')) {
        throw new OntologyCardRegistryError(
          `[ontology-collection-adapter] collection ${entry.collection} does not expose ontology attr is_deleted`
        );
      }
      const payload = {
        is_deleted: true,
        ...extraFields,
      };
      return {
        $set: this.toMongoDocument(payload),
      };
    },
  };
};

export const createOntologyMongoCollectionAdapter = async (
  collection: string,
  bridge?: OntologyPersistenceBridge
): Promise<OntologyMongoCollectionAdapter> => {
  const persistenceBridge = bridge ?? await loadOntologyPersistenceBridge();
  const registry = await loadOntologyCardRegistry();
  const entry = persistenceBridge.collections[collection];
  if (!entry) {
    throw new OntologyCardRegistryError(
      `[ontology-collection-adapter] collection ${collection} is absent from ontology persistence bridge`
    );
  }
  return createAdapterFromEntry(entry, registry);
};

export const getOntologyMongoCollectionAdapter = (collection: string): OntologyMongoCollectionAdapter => {
  const bridge = getOntologyPersistenceBridge();
  const registry = getOntologyCardRegistry();
  const entry = bridge.collections[collection];
  if (!entry) {
    throw new OntologyCardRegistryError(
      `[ontology-collection-adapter] collection ${collection} is absent from loaded ontology persistence bridge`
    );
  }
  return createAdapterFromEntry(entry, registry);
};
