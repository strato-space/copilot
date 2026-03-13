#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import {
  upsertProjectPerformerLink,
  upsertTelegramChat,
  upsertTelegramChatMembership,
  upsertTelegramUser,
} from '../src/services/telegramKnowledge.js';
import { extractRoutingProjectSources } from '../src/utils/routingConfig.js';

type ChatShape = {
  chat_id: string;
  name: string;
  chat_type: string;
  directives?: string | null;
};

type PerformerCrosswalkRow = {
  sheet_name: string;
  match_confidence?: string | null;
  voice_person_id?: string | null;
  voice_performer_id?: string | null;
  telegram_id?: string | null;
  telegram_name?: string | null;
  corporate_email?: string | null;
};

type ProjectCrosswalkRow = {
  sheet_aliases?: string[];
  voice_project_id: string;
  voice_project_name?: string;
  routing_topic?: string;
  known_sheet_performers?: string[];
};

type ChatMemberRow = {
  chat: ChatShape | null;
  performer_sheet_name: string;
  voice_person_id?: string | null;
  voice_performer_id?: string | null;
  telegram_id?: string | null;
  telegram_name?: string | null;
  projects?: string[];
  membership_status?: string;
  relation_kind?: string;
};

type KnowledgeFile = {
  'performer-crosswalk'?: PerformerCrosswalkRow[];
  'project-crosswalk'?: ProjectCrosswalkRow[];
  'telegram-chats'?: Array<{ chat: ChatShape; projects?: string[] }>;
  'telegram-chat-members'?: ChatMemberRow[];
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = process.env.DOTENV_CONFIG_PATH
  ? resolve(process.cwd(), process.env.DOTENV_CONFIG_PATH)
  : resolve(__dirname, '../.env.development');
const envLoadResult = dotenv.config({ path: envPath, override: true });

if (envLoadResult.error) {
  throw new Error(`Failed to load env file: ${envPath}. ${String(envLoadResult.error)}`);
}

const knowledgePath = resolve('/home/strato-space/settings/chat-members.json');
const routingPath = resolve('/home/strato-space/settings/routing-prod.json');

const resolveMongoUri = (): string => {
  if (process.env.MONGODB_CONNECTION_STRING) return process.env.MONGODB_CONNECTION_STRING;
  const { MONGO_USER, MONGO_PASSWORD, MONGODB_HOST, MONGODB_PORT, DB_NAME } = process.env;
  if (!MONGO_USER || !MONGO_PASSWORD || !MONGODB_HOST || !MONGODB_PORT || !DB_NAME) {
    throw new Error('Mongo env is incomplete');
  }
  return `mongodb://${MONGO_USER}:${MONGO_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${DB_NAME}?authSource=admin&directConnection=true`;
};

const resolveDbName = (): string => {
  const value = process.env.DB_NAME;
  if (!value) throw new Error('DB_NAME is not set');
  return value;
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return ObjectId.isValid(trimmed) ? new ObjectId(trimmed) : null;
};

const isGroupLikeChat = (chat: ChatShape): boolean =>
  chat.chat_type === 'project_chat' || chat.chat_type === 'performer_chat' || chat.chat_type === 'general_design_chat';

const loadJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf-8')) as T;

async function main(): Promise<void> {
  const [knowledge, routing] = await Promise.all([
    loadJson<KnowledgeFile>(knowledgePath),
    loadJson<Array<Record<string, unknown>>>(routingPath),
  ]);

  const performerBySheetName = new Map<string, PerformerCrosswalkRow>();
  for (const row of knowledge['performer-crosswalk'] || []) {
    performerBySheetName.set(row.sheet_name, row);
  }

  const projectByAlias = new Map<string, string>();
  const setProjectAlias = (alias: string | null | undefined, projectId: string) => {
    const key = String(alias || '').trim().toLowerCase();
    if (!key || projectByAlias.has(key)) return;
    projectByAlias.set(key, projectId);
  };

  for (const row of knowledge['project-crosswalk'] || []) {
    for (const alias of row.sheet_aliases || []) {
      setProjectAlias(alias, row.voice_project_id);
    }
    if (row.voice_project_name) {
      setProjectAlias(row.voice_project_name, row.voice_project_id);
    }
    if (row.routing_topic) {
      setProjectAlias(row.routing_topic, row.voice_project_id);
      const tail = row.routing_topic.split('/').map((part) => part.trim()).filter(Boolean).at(-1);
      if (tail) setProjectAlias(tail, row.voice_project_id);
    }
  }

  for (const item of routing) {
    const topic = typeof item.topic === 'string' ? item.topic : null;
    const routingProjects = extractRoutingProjectSources(item);
    if (topic && routingProjects.length === 1) {
      setProjectAlias(topic, routingProjects[0]?.project_id || '');
      const tail = topic.split('/').map((part) => part.trim()).filter(Boolean).at(-1);
      if (tail) setProjectAlias(tail, routingProjects[0]?.project_id || '');
    }
    for (const project of routingProjects) {
      setProjectAlias(project.name, project.project_id);
      setProjectAlias(project.alias, project.project_id);
    }
  }

  const client = new MongoClient(resolveMongoUri());
  await client.connect();
  const db = client.db(resolveDbName());

  let chatCount = 0;
  let userCount = 0;
  let membershipCount = 0;
  let projectLinkCount = 0;

  try {
    for (const row of knowledge['performer-crosswalk'] || []) {
      if (!row.telegram_id) continue;
      if (apply) {
        await upsertTelegramUser(db, {
          telegram_id: row.telegram_id,
          username: row.telegram_name ?? null,
          display_name: row.sheet_name,
          performer_id: toObjectIdOrNull(row.voice_performer_id),
          person_id: toObjectIdOrNull(row.voice_person_id),
          is_active: true,
        });
      }
      userCount += 1;
    }

    for (const row of knowledge['telegram-chats'] || []) {
      const chat = row.chat;
      if (!isGroupLikeChat(chat)) continue;
      const linkedProjectIds = (row.projects || [])
        .map((name) => projectByAlias.get(name.trim().toLowerCase()) || null)
        .filter((value): value is string => Boolean(value))
        .map((value) => new ObjectId(value));

      if (apply) {
        await upsertTelegramChat(db, {
          chat_id: chat.chat_id,
          name: chat.name,
          chat_type: 'group',
          source_kind: chat.chat_type,
          directives: chat.directives ?? null,
          linked_project_ids: linkedProjectIds,
          is_active: true,
        });
      }
      chatCount += 1;
    }

    for (const row of knowledge['telegram-chat-members'] || []) {
      if (!row.chat || row.membership_status !== 'confirmed') continue;
      const chat = row.chat;
      if (!isGroupLikeChat(chat) || !row.telegram_id) continue;
      if (apply) {
        await upsertTelegramChatMembership(db, {
          chat_id: chat.chat_id,
          telegram_user_id: row.telegram_id,
          membership_role: null,
          membership_source: 'chat_members_json',
          joined_at: null,
          left_at: null,
          is_active: true,
        });
      }
      membershipCount += 1;
    }

    const intervalStart = new Date('2026-02-01T00:00:00.000Z');
    const intervalEnd = new Date('2026-02-27T23:59:59.000Z');
    for (const row of knowledge['project-crosswalk'] || []) {
      const projectId = toObjectIdOrNull(row.voice_project_id);
      if (!projectId) continue;
      for (const performerName of row.known_sheet_performers || []) {
        const performer = performerBySheetName.get(performerName);
        if (!performer?.voice_performer_id) continue;
        if (apply) {
          await upsertProjectPerformerLink(db, {
            project_id: projectId,
            performer_id: new ObjectId(performer.voice_performer_id),
            person_id: toObjectIdOrNull(performer.voice_person_id),
            role: null,
            source: 'worksheet_q2_01_02_27_02',
            confidence: performer.match_confidence === 'exact' ? 'high' : 'medium',
            start_date: intervalStart,
            end_date: intervalEnd,
            is_active: false,
          });
        }
        projectLinkCount += 1;
      }
    }

    for (const row of knowledge['telegram-chat-members'] || []) {
      if (row.membership_status !== 'confirmed' || row.relation_kind !== 'performer_chat') continue;
      const performerId = toObjectIdOrNull(row.voice_performer_id);
      if (!performerId) continue;
      for (const projectName of row.projects || []) {
        const projectId = toObjectIdOrNull(projectByAlias.get(projectName.trim().toLowerCase()) || null);
        if (!projectId) continue;
        if (apply) {
          await upsertProjectPerformerLink(db, {
            project_id: projectId,
            performer_id: performerId,
            person_id: toObjectIdOrNull(row.voice_person_id),
            role: null,
            source: 'performer_chat_seed',
            confidence: 'medium',
            start_date: new Date('2026-03-03T00:00:00.000Z'),
            end_date: null,
            is_active: true,
          });
        }
        projectLinkCount += 1;
      }
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      envPath,
      knowledgePath,
      dbName: resolveDbName(),
      telegram_users: userCount,
      telegram_chats: chatCount,
      telegram_chat_memberships: membershipCount,
      project_performer_links: projectLinkCount,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('seed-telegram-knowledge failed:', error);
  process.exitCode = 1;
});
