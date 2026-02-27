import { ObjectId } from 'mongodb';

type QueryRecord = Record<string, unknown>;

const HIDDEN_PERFORMER_EMAIL_PATTERNS = [
  /^gatitulin@strato\.space$/i,
  /^vilco@yandex\.ru$/i,
];

const HIDDEN_PERFORMER_ALIAS_PATTERNS = [
  /^d1zmens$/i,
  /^vilco_o$/i,
];

const HIDDEN_FROM_ACTIVE_SELECTOR_CLAUSE: QueryRecord = {
  $nor: [
    { corporate_email: { $in: HIDDEN_PERFORMER_EMAIL_PATTERNS } },
    { email: { $in: HIDDEN_PERFORMER_EMAIL_PATTERNS } },
    { name: { $in: HIDDEN_PERFORMER_ALIAS_PATTERNS } },
    { real_name: { $in: HIDDEN_PERFORMER_ALIAS_PATTERNS } },
    { username: { $in: HIDDEN_PERFORMER_ALIAS_PATTERNS } },
    { telegram_username: { $in: HIDDEN_PERFORMER_ALIAS_PATTERNS } },
    { login: { $in: HIDDEN_PERFORMER_ALIAS_PATTERNS } },
  ],
};

const ACTIVE_LIFECYCLE_CLAUSES: QueryRecord[] = [
  { is_deleted: { $ne: true } },
  { is_active: { $ne: false } },
  { active: { $ne: false } },
  HIDDEN_FROM_ACTIVE_SELECTOR_CLAUSE,
];

const hasOwnKeys = (input: QueryRecord): boolean => Object.keys(input).length > 0;

export const buildActivePerformerFilter = (extraFilter: QueryRecord = {}): QueryRecord => {
  const clauses = hasOwnKeys(extraFilter)
    ? [extraFilter, ...ACTIVE_LIFECYCLE_CLAUSES]
    : [...ACTIVE_LIFECYCLE_CLAUSES];

  if (clauses.length === 1) return clauses[0] ?? {};
  return { $and: clauses };
};

export const buildPerformerSelectorFilter = ({
  extraFilter = {},
  includeIds = [],
}: {
  extraFilter?: QueryRecord;
  includeIds?: ObjectId[];
} = {}): QueryRecord => {
  const activeFilter = buildActivePerformerFilter(extraFilter);
  if (!includeIds.length) return activeFilter;

  return {
    $or: [
      activeFilter,
      { _id: { $in: includeIds } },
    ],
  };
};
