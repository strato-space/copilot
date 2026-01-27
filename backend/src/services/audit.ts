import { randomUUID } from 'crypto';
import { type Collection } from 'mongodb';
import { getDb } from './db.js';
import { COLLECTIONS } from '../models/collections.js';
import { type ActorType, type AuditEvent } from '../models/types.js';

export interface AuditEventInput {
  actor_type: ActorType;
  actor_id?: string | null;
  action: string;
  entity_type: string;
  entity_key: string;
  changes: unknown[];
  comment?: string | null;
  request_id?: string | null;
}

const getAuditCollection = (): Collection<AuditEvent> => {
  return getDb().collection<AuditEvent>(COLLECTIONS.AUDIT_EVENTS);
};

export const logAuditEvent = async (input: AuditEventInput): Promise<AuditEvent> => {
  const event: AuditEvent = {
    event_id: randomUUID(),
    timestamp: new Date(),
    actor_type: input.actor_type,
    actor_id: input.actor_id ?? null,
    action: input.action,
    entity_type: input.entity_type,
    entity_key: input.entity_key,
    changes: input.changes,
    comment: input.comment ?? null,
    request_id: input.request_id ?? null,
  };

  await getAuditCollection().insertOne(event);
  return event;
};
