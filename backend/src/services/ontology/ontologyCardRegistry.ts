import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { dirname, relative, resolve } from 'path';
import YAML from 'yaml';

const resolveDefaultFragmentsRoot = (): string => {
  const candidates = [
    resolve(process.cwd(), '../ontology/typedb/schema/fragments'),
    resolve(process.cwd(), 'ontology/typedb/schema/fragments'),
  ];
  const discovered = candidates.find((candidate) => existsSync(candidate));
  if (discovered) return discovered;
  const fallback = candidates[0];
  if (!fallback) {
    throw new OntologyCardRegistryError('No ontology fragments root candidates were generated.');
  }
  return fallback;
};

const DEFAULT_FRAGMENTS_ROOT = resolveDefaultFragmentsRoot();

const CARD_START_RE = /^# --- <semantic-card id="([^"]+)"> ---$/;
const CARD_END_RE = /^# --- <\/semantic-card> ---$/;
const ATTRIBUTE_DEFINITION_RE =
  /^\s*attribute\s+([A-Za-z0-9_]+)(?:\s+sub\s+([A-Za-z0-9_]+))?(?:\s*,\s*value\s+(string|boolean|long|double|datetime))?\s*;/;
const DEFINITION_RE = /^\s*(entity|relation|attribute)\s+([A-Za-z0-9_]+)(?:\s+sub\s+([A-Za-z0-9_]+))?\b/;
const OWNS_RE = /^\s*owns\s+([A-Za-z0-9_]+)\b/;
const RELATES_RE = /^\s*relates\s+([A-Za-z0-9_]+)\b/;
const PLAYS_RE = /^\s*plays\s+([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)?)\b/;
const VALUES_RE = /@values\(([^)]*)\)/;

export type OntologyCardDefinitionKind = 'entity' | 'relation' | 'attribute';
export type OntologyAttributeValueType = 'string' | 'boolean' | 'long' | 'double' | 'datetime';

export interface OntologyAttributeDefinition {
  label: string;
  supertypeLabel: string | null;
  valueType: OntologyAttributeValueType | null;
  fragmentPath: string;
  sourceLine: number;
}

export interface OntologyOwnedAttributeSpec {
  label: string;
  valueType: OntologyAttributeValueType | null;
  enumValues: string[];
}

export interface OntologyCardMetadata {
  kind?: string;
  fpf_basis?: string[];
  scope?: string;
  what?: string;
  not?: string;
  why?: string;
  [key: string]: unknown;
}

export interface OntologyCardEntry {
  id: string;
  label: string;
  definitionKind: OntologyCardDefinitionKind;
  supertypeLabel: string | null;
  fragmentPath: string;
  section: string;
  sourceStartLine: number;
  sourceEndLine: number;
  metadata: OntologyCardMetadata;
  owns: string[];
  effectiveOwns: string[];
  ownAttributeSpecs: Record<string, OntologyOwnedAttributeSpec>;
  effectiveOwnAttributeSpecs: Record<string, OntologyOwnedAttributeSpec>;
  relates: string[];
  plays: string[];
  definition: string;
  blockHash: string;
}

export interface OntologyCardRegistry {
  fragmentsRoot: string;
  registryHash: string;
  cardCount: number;
  attributes: Record<string, OntologyAttributeDefinition>;
  cards: Record<string, OntologyCardEntry>;
}

export class OntologyCardRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OntologyCardRegistryError';
  }
}

let cachedRegistry: OntologyCardRegistry | null = null;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const stripCommentPrefix = (line: string): string => {
  if (line === '#') return '';
  if (line.startsWith('# ')) return line.slice(2);
  if (line.startsWith('#')) return line.slice(1);
  return line;
};

const parseMetadata = (metadataLines: string[], context: string): OntologyCardMetadata => {
  const text = metadataLines.join('\n').trim();
  if (!text) return {};
  const parsed = YAML.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OntologyCardRegistryError(`[ontology-card-registry] invalid metadata object in ${context}`);
  }
  return parsed as OntologyCardMetadata;
};

const parseQuotedValues = (rawValueSet: string): string[] =>
  Array.from(rawValueSet.matchAll(/"([^"]+)"/g))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);

const extractDefinition = (
  bodyLines: string[],
  context: string
): {
  label: string;
  definitionKind: OntologyCardDefinitionKind;
  supertypeLabel: string | null;
  owns: string[];
  ownAttributeSpecs: Record<string, OntologyOwnedAttributeSpec>;
  relates: string[];
  plays: string[];
  definition: string;
} => {
  const nonEmptyBodyLines = bodyLines.filter((line) => line.trim().length > 0);
  const definitionLine = nonEmptyBodyLines.find((line) => !line.trim().startsWith('#'));
  if (!definitionLine) {
    throw new OntologyCardRegistryError(`[ontology-card-registry] missing TQL definition in ${context}`);
  }

  const definitionMatch = definitionLine.match(DEFINITION_RE);
  if (!definitionMatch) {
    throw new OntologyCardRegistryError(
      `[ontology-card-registry] unsupported TQL definition header in ${context}: ${definitionLine.trim()}`
    );
  }

  const definitionKind = definitionMatch[1];
  const label = definitionMatch[2];
  const supertypeLabel = definitionMatch[3] ?? null;
  if (!definitionKind || !label) {
    throw new OntologyCardRegistryError(
      `[ontology-card-registry] incomplete TQL definition header in ${context}: ${definitionLine.trim()}`
    );
  }
  const owns = new Set<string>();
  const ownAttributeSpecs = new Map<string, OntologyOwnedAttributeSpec>();
  const relates = new Set<string>();
  const plays = new Set<string>();

  for (const rawLine of bodyLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const ownsMatch = line.match(OWNS_RE);
    if (ownsMatch?.[1]) {
      owns.add(ownsMatch[1]);
      ownAttributeSpecs.set(ownsMatch[1], {
        label: ownsMatch[1],
        valueType: null,
        enumValues: parseQuotedValues(line.match(VALUES_RE)?.[1] ?? ''),
      });
    }

    const relatesMatch = line.match(RELATES_RE);
    if (relatesMatch?.[1]) relates.add(relatesMatch[1]);

    const playsMatch = line.match(PLAYS_RE);
    if (playsMatch?.[1]) plays.add(playsMatch[1]);
  }

  return {
    label,
    definitionKind: definitionKind as OntologyCardDefinitionKind,
    supertypeLabel,
    owns: [...owns],
    ownAttributeSpecs: Object.fromEntries([...ownAttributeSpecs.entries()].map(([label, spec]) => [label, spec])),
    relates: [...relates],
    plays: [...plays],
    definition: bodyLines.join('\n').trim(),
  };
};

const resolveEffectiveOwns = (
  cardsById: Map<string, OntologyCardEntry>,
  attributesByLabel: Map<string, OntologyAttributeDefinition>
): void => {
  const cache = new Map<string, string[]>();
  const specCache = new Map<string, Record<string, OntologyOwnedAttributeSpec>>();
  const cardsByLabel = new Map<string, OntologyCardEntry>();

  for (const card of cardsById.values()) {
    const existing = cardsByLabel.get(card.label);
    if (existing && existing.id !== card.id) {
      throw new OntologyCardRegistryError(
        `[ontology-card-registry] duplicate semantic-card label "${card.label}" in ${existing.fragmentPath}:${existing.sourceStartLine} and ${card.fragmentPath}:${card.sourceStartLine}`
      );
    }
    cardsByLabel.set(card.label, card);
  }

  const visit = (cardId: string, stack: string[] = []): string[] => {
    const cached = cache.get(cardId);
    if (cached) return cached;

    const card = cardsById.get(cardId);
    if (!card) return [];
    if (stack.includes(cardId)) {
      throw new OntologyCardRegistryError(
        `[ontology-card-registry] cyclic supertype chain detected: ${[...stack, cardId].join(' -> ')}`
      );
    }

    const supertypeCardId = card.supertypeLabel ? cardsByLabel.get(card.supertypeLabel)?.id ?? null : null;
    const inherited = supertypeCardId ? visit(supertypeCardId, [...stack, cardId]) : [];
    const merged = [...new Set([...inherited, ...card.owns])];
    cache.set(cardId, merged);
    return merged;
  };

  const visitSpecs = (cardId: string, stack: string[] = []): Record<string, OntologyOwnedAttributeSpec> => {
    const cached = specCache.get(cardId);
    if (cached) return cached;

    const card = cardsById.get(cardId);
    if (!card) return {};
    if (stack.includes(cardId)) {
      throw new OntologyCardRegistryError(
        `[ontology-card-registry] cyclic supertype chain detected: ${[...stack, cardId].join(' -> ')}`
      );
    }

    const supertypeCardId = card.supertypeLabel ? cardsByLabel.get(card.supertypeLabel)?.id ?? null : null;
    const inherited = supertypeCardId ? visitSpecs(supertypeCardId, [...stack, cardId]) : {};
    const merged = new Map<string, OntologyOwnedAttributeSpec>(
      Object.entries(inherited).map(([label, spec]) => [label, spec])
    );

    for (const ownLabel of card.owns) {
      const ownSpec = card.ownAttributeSpecs[ownLabel];
      const attributeDefinition = attributesByLabel.get(ownLabel);
      merged.set(ownLabel, {
        label: ownLabel,
        valueType: attributeDefinition?.valueType ?? ownSpec?.valueType ?? null,
        enumValues: ownSpec?.enumValues ?? [],
      });
    }

    const resolved = Object.fromEntries([...merged.entries()].map(([label, spec]) => [label, spec]));
    specCache.set(cardId, resolved);
    return resolved;
  };

  for (const cardId of cardsById.keys()) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    card.effectiveOwns = visit(cardId);
    card.effectiveOwnAttributeSpecs = visitSpecs(cardId);
  }
};

const parseAttributeDefinitionsFromText = (
  text: string,
  filePath: string,
  fragmentsRoot: string
): OntologyAttributeDefinition[] => {
  const lines = text.split(/\r?\n/);
  const definitions: OntologyAttributeDefinition[] = [];

  for (const [lineIndex, rawLine] of lines.entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = rawLine.match(ATTRIBUTE_DEFINITION_RE);
    if (!match?.[1]) continue;

    definitions.push({
      label: match[1],
      supertypeLabel: match[2] ?? null,
      valueType: (match[3] as OntologyAttributeValueType | undefined) ?? null,
      fragmentPath: relative(fragmentsRoot, filePath).replace(/\\/g, '/'),
      sourceLine: lineIndex + 1,
    });
  }

  return definitions;
};

const listTqlFiles = async (dirPath: string): Promise<string[]> => {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      return listTqlFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.tql') ? [fullPath] : [];
  }));

  return files.flat().sort((left, right) => left.localeCompare(right));
};

const parseCardsFromFile = async (filePath: string, fragmentsRoot: string): Promise<OntologyCardEntry[]> => {
  const text = await readFile(filePath, 'utf-8');
  const lines = text.split(/\r?\n/);
  const cards: OntologyCardEntry[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const startMatch = lines[lineIndex]?.match(CARD_START_RE);
    if (!startMatch?.[1]) continue;

    const cardId = startMatch[1];
    const sourceStartLine = lineIndex + 1;
    const metadataLines: string[] = [];
    const bodyLines: string[] = [];
    let inDefinition = false;
    let sourceEndLine = 0;
    let closed = false;

    for (lineIndex += 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? '';

      if (CARD_START_RE.test(line)) {
        throw new OntologyCardRegistryError(
          `[ontology-card-registry] nested semantic-card start before closing ${cardId} in ${filePath}:${lineIndex + 1}`
        );
      }

      if (CARD_END_RE.test(line)) {
        sourceEndLine = lineIndex + 1;
        closed = true;
        break;
      }

      if (!inDefinition) {
        if (line.trim() === '' || line.trim().startsWith('#')) {
          metadataLines.push(line.trim() === '' ? '' : stripCommentPrefix(line));
          continue;
        }
        inDefinition = true;
      }

      bodyLines.push(line);
    }

    if (!closed) {
      throw new OntologyCardRegistryError(
        `[ontology-card-registry] unterminated semantic-card ${cardId} in ${filePath}:${sourceStartLine}`
      );
    }

    const relativePath = relative(fragmentsRoot, filePath).replace(/\\/g, '/');
    const metadata = parseMetadata(metadataLines, `${relativePath}:${sourceStartLine}`);
    const definition = extractDefinition(bodyLines, `${relativePath}:${sourceStartLine}`);
    const blockHash = sha256([
      cardId,
      JSON.stringify(metadata),
      definition.definition,
      `${relativePath}:${sourceStartLine}:${sourceEndLine}`,
    ].join('\n'));

    cards.push({
      id: cardId,
      label: definition.label,
      definitionKind: definition.definitionKind,
      fragmentPath: relativePath,
      section: relative(fragmentsRoot, dirname(filePath)).replace(/\\/g, '/'),
      sourceStartLine,
      sourceEndLine,
      metadata,
      owns: definition.owns,
      effectiveOwns: [...definition.owns],
      ownAttributeSpecs: definition.ownAttributeSpecs,
      effectiveOwnAttributeSpecs: definition.ownAttributeSpecs,
      relates: definition.relates,
      plays: definition.plays,
      supertypeLabel: definition.supertypeLabel,
      definition: definition.definition,
      blockHash,
    });
  }

  return cards;
};

export const buildOntologyCardRegistry = async (
  fragmentsRoot: string = process.env.ONTOLOGY_TQL_FRAGMENTS_ROOT ?? DEFAULT_FRAGMENTS_ROOT
): Promise<OntologyCardRegistry> => {
  const files = await listTqlFiles(fragmentsRoot);
  const cardsById = new Map<string, OntologyCardEntry>();
  const attributesByLabel = new Map<string, OntologyAttributeDefinition>();

  for (const filePath of files) {
    const fileText = await readFile(filePath, 'utf-8');
    for (const definition of parseAttributeDefinitionsFromText(fileText, filePath, fragmentsRoot)) {
      const existingDefinition = attributesByLabel.get(definition.label);
      if (existingDefinition && existingDefinition.valueType !== definition.valueType) {
        throw new OntologyCardRegistryError(
          `[ontology-card-registry] conflicting attribute value type for "${definition.label}" in ${existingDefinition.fragmentPath}:${existingDefinition.sourceLine} and ${definition.fragmentPath}:${definition.sourceLine}`
        );
      }
      if (!existingDefinition) {
        attributesByLabel.set(definition.label, definition);
      }
    }
    const cards = await parseCardsFromFile(filePath, fragmentsRoot);
    for (const card of cards) {
      const existing = cardsById.get(card.id);
      if (existing) {
        throw new OntologyCardRegistryError(
          `[ontology-card-registry] duplicate semantic-card id "${card.id}" in ${existing.fragmentPath}:${existing.sourceStartLine} and ${card.fragmentPath}:${card.sourceStartLine}`
        );
      }
      cardsById.set(card.id, card);
    }
  }

  resolveEffectiveOwns(cardsById, attributesByLabel);

  const sortedEntries = [...cardsById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const registryHash = sha256(
    sortedEntries.map((entry) => `${entry.id}:${entry.blockHash}:${entry.fragmentPath}`).join('\n')
  );

  return {
    fragmentsRoot,
    registryHash,
    cardCount: sortedEntries.length,
    attributes: Object.fromEntries([...attributesByLabel.entries()].map(([label, definition]) => [label, definition])),
    cards: Object.fromEntries(sortedEntries.map((entry) => [entry.id, entry])),
  };
};

export const loadOntologyCardRegistry = async (
  fragmentsRoot?: string
): Promise<OntologyCardRegistry> => {
  if (cachedRegistry) return cachedRegistry;
  cachedRegistry = await buildOntologyCardRegistry(fragmentsRoot);
  return cachedRegistry;
};

export const getOntologyCardRegistry = (): OntologyCardRegistry => {
  if (!cachedRegistry) {
    throw new OntologyCardRegistryError('Ontology card registry not initialized. Call loadOntologyCardRegistry() first.');
  }
  return cachedRegistry;
};

export const resetOntologyCardRegistryForTests = (): void => {
  cachedRegistry = null;
};
