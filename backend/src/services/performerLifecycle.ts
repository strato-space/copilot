import { ObjectId } from 'mongodb';

type QueryRecord = Record<string, unknown>;

const ACTIVE_LIFECYCLE_CLAUSES: QueryRecord[] = [
  { is_deleted: { $ne: true } },
  { is_active: { $ne: false } },
  { active: { $ne: false } },
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
