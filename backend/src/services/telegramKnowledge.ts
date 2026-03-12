import {
  Collection,
  type Db,
  ObjectId,
  type OptionalId,
  type WithId,
} from 'mongodb';
import { COLLECTIONS } from '../constants.js';
import { toIdString, toObjectIdArray, toObjectIdOrNull } from '../api/routes/voicebot/sessionsSharedUtils.js';

export type TelegramChatSourceKind =
  | 'project_chat'
  | 'performer_chat'
  | 'general_design_chat'
  | 'direct_user_chat';

export interface TelegramChatDocument {
  _id?: ObjectId;
  chat_id: string;
  name: string;
  chat_type?: string;
  source_kind?: TelegramChatSourceKind | string;
  directives?: string | null;
  linked_project_ids?: ObjectId[];
  is_active?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface TelegramUserDocument {
  _id?: ObjectId;
  telegram_id: string;
  username?: string | null;
  display_name?: string | null;
  performer_id?: ObjectId | null;
  person_id?: ObjectId | null;
  is_active?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface TelegramChatMembershipDocument {
  _id?: ObjectId;
  chat_id: string;
  telegram_user_id: string;
  membership_role?: string | null;
  membership_source?: string | null;
  joined_at?: Date | null;
  left_at?: Date | null;
  is_active?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface ProjectPerformerLinkDocument {
  _id?: ObjectId;
  project_id: ObjectId;
  performer_id: ObjectId;
  person_id?: ObjectId | null;
  role?: string | null;
  source?: string | null;
  confidence?: string | null;
  start_date?: Date | null;
  end_date?: Date | null;
  is_active?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface TelegramUserRef {
  telegram_id: string;
  username: string | null;
  display_name: string | null;
  performer_id: string | null;
  person_id: string | null;
  is_fallback?: boolean;
}

export interface TelegramChatRef {
  chat_id: string;
  name: string;
  chat_type: string | null;
  source_kind: string | null;
  directives: string | null;
  linked_project_ids: string[];
}

export interface ProjectPerformerLinkRef {
  id: string | null;
  project_id: string;
  performer_id: string;
  person_id: string | null;
  role: string | null;
  source: string | null;
  confidence: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

type MinimalPerformer = {
  _id?: unknown;
  telegram_id?: unknown;
  telegram_name?: unknown;
};

type MinimalPerson = {
  _id?: unknown;
  performer_id?: unknown;
  performer?: {
    _id?: unknown;
    telegram_id?: unknown;
    telegram_name?: unknown;
  } | null;
};

type MinimalProject = {
  _id?: unknown;
};

type EnrichedTelegramRefs = {
  telegram_user: TelegramUserRef | null;
  telegram_chats: TelegramChatRef[];
};

type FindResult<T> = {
  toArray?: () => Promise<WithId<T>[]>;
};

type FindableCollection<T> = {
  find?: (query: Record<string, unknown>) => FindResult<T> | null | undefined;
};

const getTelegramChatsCollection = (db: Db): Collection<TelegramChatDocument> =>
  db.collection<TelegramChatDocument>(COLLECTIONS.TELEGRAM_CHATS);

const getTelegramUsersCollection = (db: Db): Collection<TelegramUserDocument> =>
  db.collection<TelegramUserDocument>(COLLECTIONS.TELEGRAM_USERS);

const getTelegramChatMembershipsCollection = (db: Db): Collection<TelegramChatMembershipDocument> =>
  db.collection<TelegramChatMembershipDocument>(COLLECTIONS.TELEGRAM_CHAT_MEMBERSHIPS);

const getProjectPerformerLinksCollection = (db: Db): Collection<ProjectPerformerLinkDocument> =>
  db.collection<ProjectPerformerLinkDocument>(COLLECTIONS.PROJECT_PERFORMER_LINKS);

const uniqueStrings = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));

const safeFindToArray = async <T>(
  collection: FindableCollection<T>,
  query: Record<string, unknown>,
): Promise<WithId<T>[]> => {
  if (typeof collection.find !== 'function') return [];
  const cursor = collection.find(query);
  if (!cursor || typeof cursor.toArray !== 'function') return [];
  return cursor.toArray();
};

const toDateOrNull = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const toTelegramUserRef = (
  doc: TelegramUserDocument,
  fallback = false,
): TelegramUserRef => ({
  telegram_id: String(doc.telegram_id),
  username: typeof doc.username === 'string' ? doc.username : null,
  display_name: typeof doc.display_name === 'string' ? doc.display_name : null,
  performer_id: toIdString(doc.performer_id),
  person_id: toIdString(doc.person_id),
  ...(fallback ? { is_fallback: true } : {}),
});

const toTelegramChatRef = (doc: TelegramChatDocument): TelegramChatRef => ({
  chat_id: String(doc.chat_id),
  name: String(doc.name ?? ''),
  chat_type: typeof doc.chat_type === 'string' ? doc.chat_type : null,
  source_kind: typeof doc.source_kind === 'string' ? doc.source_kind : null,
  directives: typeof doc.directives === 'string' ? doc.directives : null,
  linked_project_ids: toObjectIdArray(doc.linked_project_ids).map((value) => value.toHexString()),
});

const toProjectPerformerLinkRef = (doc: WithId<ProjectPerformerLinkDocument>): ProjectPerformerLinkRef => ({
  id: toIdString(doc._id),
  project_id: doc.project_id.toHexString(),
  performer_id: doc.performer_id.toHexString(),
  person_id: toIdString(doc.person_id),
  role: typeof doc.role === 'string' ? doc.role : null,
  source: typeof doc.source === 'string' ? doc.source : null,
  confidence: typeof doc.confidence === 'string' ? doc.confidence : null,
  start_date: doc.start_date instanceof Date ? doc.start_date.toISOString() : null,
  end_date: doc.end_date instanceof Date ? doc.end_date.toISOString() : null,
  is_active: doc.is_active !== false,
});

const buildFallbackTelegramUser = (performer: MinimalPerformer): TelegramUserRef | null => {
  const telegramId = String(performer.telegram_id ?? '').trim();
  const telegramName = String(performer.telegram_name ?? '').trim();
  if (!telegramId && !telegramName) return null;
  return {
    telegram_id: telegramId,
    username: telegramName || null,
    display_name: null,
    performer_id: toIdString(performer._id),
    person_id: null,
    is_fallback: true,
  };
};

const groupChatsByUserId = (
  chats: TelegramChatDocument[],
  memberships: TelegramChatMembershipDocument[],
): Map<string, TelegramChatRef[]> => {
  const chatsByChatId = new Map(chats.map((chat) => [String(chat.chat_id), toTelegramChatRef(chat)]));
  const result = new Map<string, TelegramChatRef[]>();
  for (const membership of memberships) {
    if (membership.is_active === false) continue;
    const userId = String(membership.telegram_user_id);
    const chat = chatsByChatId.get(String(membership.chat_id));
    if (!chat) continue;
    const bucket = result.get(userId) ?? [];
    bucket.push(chat);
    result.set(userId, bucket);
  }
  return result;
};

export const upsertTelegramChat = async (
  db: Db,
  input: OptionalId<TelegramChatDocument>,
): Promise<void> => {
  const now = new Date();
  const setPayload: Partial<TelegramChatDocument> = {
    name: input.name,
    chat_type: input.chat_type ?? 'group',
    directives: input.directives ?? null,
    linked_project_ids: toObjectIdArray(input.linked_project_ids),
    is_active: input.is_active !== false,
    updated_at: now,
  };
  if (typeof input.source_kind === 'string' && input.source_kind.trim()) {
    setPayload.source_kind = input.source_kind;
  }
  await getTelegramChatsCollection(db).updateOne(
    { chat_id: String(input.chat_id) },
    {
      $set: setPayload,
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true },
  );
};

export const upsertTelegramUser = async (
  db: Db,
  input: OptionalId<TelegramUserDocument>,
): Promise<void> => {
  const now = new Date();
  await getTelegramUsersCollection(db).updateOne(
    { telegram_id: String(input.telegram_id) },
    {
      $set: {
        username: input.username ?? null,
        display_name: input.display_name ?? null,
        performer_id: toObjectIdOrNull(input.performer_id),
        person_id: toObjectIdOrNull(input.person_id),
        is_active: input.is_active !== false,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true },
  );
};

export const upsertTelegramChatMembership = async (
  db: Db,
  input: OptionalId<TelegramChatMembershipDocument>,
): Promise<void> => {
  const now = new Date();
  await getTelegramChatMembershipsCollection(db).updateOne(
    {
      chat_id: String(input.chat_id),
      telegram_user_id: String(input.telegram_user_id),
    },
    {
      $set: {
        membership_role: input.membership_role ?? null,
        membership_source: input.membership_source ?? null,
        joined_at: toDateOrNull(input.joined_at),
        left_at: toDateOrNull(input.left_at),
        is_active: input.is_active !== false,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true },
  );
};

export const upsertProjectPerformerLink = async (
  db: Db,
  input: OptionalId<ProjectPerformerLinkDocument>,
): Promise<void> => {
  const projectId = toObjectIdOrNull(input.project_id);
  const performerId = toObjectIdOrNull(input.performer_id);
  if (!projectId || !performerId) {
    throw new Error('project_id and performer_id are required for project performer link');
  }
  const personId = toObjectIdOrNull(input.person_id);
  const startDate = toDateOrNull(input.start_date);
  const now = new Date();
  await getProjectPerformerLinksCollection(db).updateOne(
    {
      project_id: projectId,
      performer_id: performerId,
      person_id: personId,
      source: input.source ?? null,
      start_date: startDate,
    },
    {
      $set: {
        role: input.role ?? null,
        confidence: input.confidence ?? null,
        end_date: toDateOrNull(input.end_date),
        is_active: input.is_active !== false,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true },
  );
};

export const enrichPerformersWithTelegramAndProjectLinks = async <T extends MinimalPerformer>(
  db: Db,
  performers: T[],
): Promise<Array<T & EnrichedTelegramRefs & { project_performer_links: ProjectPerformerLinkRef[] }>> => {
  const performerIds = performers.map((item) => toObjectIdOrNull(item._id)).filter((item): item is ObjectId => item !== null);
  const telegramIds = uniqueStrings(performers.map((item) => String(item.telegram_id ?? '').trim()));

  const [telegramUsers, projectLinks] = await Promise.all([
    safeFindToArray<TelegramUserDocument>(getTelegramUsersCollection(db), {
      $or: [
        ...(performerIds.length ? [{ performer_id: { $in: performerIds } }] : []),
        ...(telegramIds.length ? [{ telegram_id: { $in: telegramIds } }] : []),
      ],
    }),
    performerIds.length
      ? safeFindToArray<ProjectPerformerLinkDocument>(getProjectPerformerLinksCollection(db), { performer_id: { $in: performerIds } })
      : Promise.resolve([] as WithId<ProjectPerformerLinkDocument>[]),
  ]);

  const telegramUserByPerformerId = new Map<string, TelegramUserRef>();
  const telegramUserByPlatformId = new Map<string, TelegramUserRef>();
  for (const doc of telegramUsers) {
    const ref = toTelegramUserRef(doc);
    const performerId = toIdString(doc.performer_id);
    if (performerId) {
      telegramUserByPerformerId.set(performerId, ref);
    }
    telegramUserByPlatformId.set(ref.telegram_id, ref);
  }

  const effectiveTelegramUserIds = uniqueStrings(
    performers.map((performer) => {
      const performerId = toIdString(performer._id);
      const user = performerId ? telegramUserByPerformerId.get(performerId) : null;
      return user?.telegram_id ?? String(performer.telegram_id ?? '').trim();
    }),
  );

  const [memberships, chats] = effectiveTelegramUserIds.length
    ? await Promise.all([
        safeFindToArray<TelegramChatMembershipDocument>(getTelegramChatMembershipsCollection(db), {
          telegram_user_id: { $in: effectiveTelegramUserIds },
          is_active: { $ne: false },
        }),
        safeFindToArray<TelegramChatDocument>(getTelegramChatsCollection(db), { is_active: { $ne: false } }),
      ])
    : [[], []];

  const chatsByUserId = groupChatsByUserId(chats, memberships);
  const projectLinksByPerformerId = new Map<string, ProjectPerformerLinkRef[]>();
  for (const doc of projectLinks) {
    const key = doc.performer_id.toHexString();
    const bucket = projectLinksByPerformerId.get(key) ?? [];
    bucket.push(toProjectPerformerLinkRef(doc));
    projectLinksByPerformerId.set(key, bucket);
  }

  return performers.map((performer) => {
    const performerId = toIdString(performer._id);
    const confirmedTelegramUser = performerId ? telegramUserByPerformerId.get(performerId) ?? null : null;
    const fallbackTelegramUser = buildFallbackTelegramUser(performer);
    const telegramUser = confirmedTelegramUser ?? fallbackTelegramUser;
    const telegramChats = telegramUser ? (chatsByUserId.get(telegramUser.telegram_id) ?? []) : [];
    const projectPerformerLinks = performerId ? (projectLinksByPerformerId.get(performerId) ?? []) : [];
    return {
      ...performer,
      telegram_user: telegramUser,
      telegram_chats: telegramChats,
      project_performer_links: projectPerformerLinks,
    };
  });
};

export const enrichPersonsWithTelegramAndProjectLinks = async <T extends MinimalPerson>(
  db: Db,
  persons: T[],
): Promise<Array<T & EnrichedTelegramRefs & { project_performer_links: ProjectPerformerLinkRef[] }>> => {
  const personIds = persons.map((item) => toObjectIdOrNull(item._id)).filter((item): item is ObjectId => item !== null);
  const performerIds = persons
    .map((item) => toObjectIdOrNull(item.performer_id ?? item.performer?._id))
    .filter((item): item is ObjectId => item !== null);

  const [telegramUsers, projectLinks] = await Promise.all([
    (personIds.length || performerIds.length)
      ? safeFindToArray<TelegramUserDocument>(getTelegramUsersCollection(db), {
          $or: [
            ...(personIds.length ? [{ person_id: { $in: personIds } }] : []),
            ...(performerIds.length ? [{ performer_id: { $in: performerIds } }] : []),
          ],
        })
      : Promise.resolve([] as WithId<TelegramUserDocument>[]),
    (personIds.length || performerIds.length)
      ? safeFindToArray<ProjectPerformerLinkDocument>(getProjectPerformerLinksCollection(db), {
          $or: [
            ...(personIds.length ? [{ person_id: { $in: personIds } }] : []),
            ...(performerIds.length ? [{ performer_id: { $in: performerIds } }] : []),
          ],
        })
      : Promise.resolve([] as WithId<ProjectPerformerLinkDocument>[]),
  ]);

  const telegramUserByPersonId = new Map<string, TelegramUserRef>();
  const telegramUserByPerformerId = new Map<string, TelegramUserRef>();
  const telegramUsersByPlatformId = new Map<string, TelegramUserRef>();
  for (const doc of telegramUsers) {
    const ref = toTelegramUserRef(doc);
    const personId = toIdString(doc.person_id);
    const performerId = toIdString(doc.performer_id);
    if (personId) telegramUserByPersonId.set(personId, ref);
    if (performerId) telegramUserByPerformerId.set(performerId, ref);
    telegramUsersByPlatformId.set(ref.telegram_id, ref);
  }

  const effectiveTelegramUserIds = uniqueStrings(Array.from(telegramUsersByPlatformId.keys()));
  const [memberships, chats] = effectiveTelegramUserIds.length
    ? await Promise.all([
        safeFindToArray<TelegramChatMembershipDocument>(getTelegramChatMembershipsCollection(db), {
          telegram_user_id: { $in: effectiveTelegramUserIds },
          is_active: { $ne: false },
        }),
        safeFindToArray<TelegramChatDocument>(getTelegramChatsCollection(db), { is_active: { $ne: false } }),
      ])
    : [[], []];

  const chatsByUserId = groupChatsByUserId(chats, memberships);
  const linksByKey = new Map<string, ProjectPerformerLinkRef[]>();
  for (const doc of projectLinks) {
    const ref = toProjectPerformerLinkRef(doc);
    const personKey = toIdString(doc.person_id);
    if (personKey) {
      const bucket = linksByKey.get(`person:${personKey}`) ?? [];
      bucket.push(ref);
      linksByKey.set(`person:${personKey}`, bucket);
    }
    const performerKey = doc.performer_id.toHexString();
    const performerBucket = linksByKey.get(`performer:${performerKey}`) ?? [];
    performerBucket.push(ref);
    linksByKey.set(`performer:${performerKey}`, performerBucket);
  }

  return persons.map((person) => {
    const personId = toIdString(person._id);
    const performerId = toIdString(person.performer_id ?? person.performer?._id);
    const telegramUser =
      (personId ? telegramUserByPersonId.get(personId) : null)
      ?? (performerId ? telegramUserByPerformerId.get(performerId) : null)
      ?? null;
    const telegramChats = telegramUser ? (chatsByUserId.get(telegramUser.telegram_id) ?? []) : [];
    const projectPerformerLinks = [
      ...(personId ? (linksByKey.get(`person:${personId}`) ?? []) : []),
      ...(performerId ? (linksByKey.get(`performer:${performerId}`) ?? []) : []),
    ];
    return {
      ...person,
      telegram_user: telegramUser,
      telegram_chats: telegramChats,
      project_performer_links: projectPerformerLinks,
    };
  });
};

export const enrichProjectsWithTelegramAndPerformerLinks = async <T extends MinimalProject>(
  db: Db,
  projects: T[],
): Promise<Array<T & { telegram_chats: TelegramChatRef[]; project_performer_links: ProjectPerformerLinkRef[] }>> => {
  const projectIds = projects.map((item) => toObjectIdOrNull(item._id)).filter((item): item is ObjectId => item !== null);
  const [projectLinks, chats] = projectIds.length
    ? await Promise.all([
        safeFindToArray<ProjectPerformerLinkDocument>(getProjectPerformerLinksCollection(db), { project_id: { $in: projectIds } }),
        safeFindToArray<TelegramChatDocument>(getTelegramChatsCollection(db), {
          linked_project_ids: { $in: projectIds },
          is_active: { $ne: false },
        }),
      ])
    : [[], []];

  const linksByProjectId = new Map<string, ProjectPerformerLinkRef[]>();
  for (const doc of projectLinks) {
    const key = doc.project_id.toHexString();
    const bucket = linksByProjectId.get(key) ?? [];
    bucket.push(toProjectPerformerLinkRef(doc));
    linksByProjectId.set(key, bucket);
  }

  const chatsByProjectId = new Map<string, TelegramChatRef[]>();
  for (const chat of chats) {
    const ref = toTelegramChatRef(chat);
    for (const projectId of ref.linked_project_ids) {
      const bucket = chatsByProjectId.get(projectId) ?? [];
      bucket.push(ref);
      chatsByProjectId.set(projectId, bucket);
    }
  }

  return projects.map((project) => {
    const projectId = toIdString(project._id);
    return {
      ...project,
      telegram_chats: projectId ? (chatsByProjectId.get(projectId) ?? []) : [],
      project_performer_links: projectId ? (linksByProjectId.get(projectId) ?? []) : [],
    };
  });
};
