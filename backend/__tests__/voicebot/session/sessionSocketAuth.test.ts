import { describe, it, expect } from '@jest/globals';
import { ObjectId } from 'mongodb';
import { computeSessionAccess } from '../../../src/services/voicebot/session-socket-auth.js';
import { PERMISSIONS } from '../../../src/permissions/permissions-config.js';

describe('computeSessionAccess', () => {
    const performerId = new ObjectId();
    const projectId = new ObjectId();

    it('grants access to READ_ALL users', () => {
        const result = computeSessionAccess({
            session: { chat_id: 1 },
            performer: { telegram_id: '2' },
            userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL],
        });
        expect(result.hasAccess).toBe(true);
        expect(result.canReadAll).toBe(true);
    });

    it('grants access to owner via chat_id or user_id', () => {
        const byChat = computeSessionAccess({
            session: { chat_id: 777 },
            performer: { telegram_id: '777' },
            userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN],
        });
        expect(byChat.hasAccess).toBe(true);

        const byUser = computeSessionAccess({
            session: { user_id: performerId },
            performer: { _id: performerId },
            userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN],
        });
        expect(byUser.hasAccess).toBe(true);
    });

    it('grants access to public project session for assigned project member', () => {
        const result = computeSessionAccess({
            session: {
                access_level: 'public',
                project_id: projectId,
            },
            performer: {
                _id: performerId,
                projects_access: [projectId],
            },
            userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN],
        });
        expect(result.hasAccess).toBe(true);
    });

    it('grants access to restricted session for allowed user', () => {
        const result = computeSessionAccess({
            session: {
                access_level: 'restricted',
                allowed_users: [performerId],
            },
            performer: { _id: performerId },
            userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN],
        });
        expect(result.hasAccess).toBe(true);
    });

    it('denies access when none of access rules match', () => {
        const result = computeSessionAccess({
            session: {
                chat_id: 100,
                user_id: new ObjectId(),
                access_level: 'private',
            },
            performer: {
                _id: performerId,
                telegram_id: '200',
                projects_access: [],
            },
            userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN],
        });
        expect(result.hasAccess).toBe(false);
    });
});
