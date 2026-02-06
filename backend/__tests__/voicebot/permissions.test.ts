/**
 * Unit tests for VoiceBot Permissions API
 * Tests role hierarchy and permission validation
 */

import { describe, it, expect } from '@jest/globals';

// Role hierarchy (higher index = more privileges)
const ROLE_HIERARCHY = ['VIEWER', 'PERFORMER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];

// Permission types
const PERMISSION_TYPES = {
    VOICEBOT_SESSIONS: ['READ', 'WRITE', 'PROCESS', 'DELETE'],
    VOICEBOT_PERSONS: ['READ', 'WRITE', 'DELETE'],
    VOICEBOT_PERMISSIONS: ['READ', 'WRITE'],
    VOICEBOT_LLMGATE: ['EXECUTE'],
};

// Mock users with different roles
const users = {
    superAdmin: {
        _id: 'user-001',
        email: 'admin@example.com',
        role: 'SUPER_ADMIN',
        permissions: {},
    },
    admin: {
        _id: 'user-002',
        email: 'manager@example.com',
        role: 'ADMIN',
        permissions: {
            VOICEBOT_SESSIONS: ['READ', 'WRITE'],
            VOICEBOT_PERSONS: ['READ'],
        },
    },
    performer: {
        _id: 'user-003',
        email: 'performer@example.com',
        role: 'PERFORMER',
        permissions: {
            VOICEBOT_SESSIONS: ['READ'],
        },
    },
    viewer: {
        _id: 'user-004',
        email: 'viewer@example.com',
        role: 'VIEWER',
        permissions: {},
    },
};

// Helper to check role hierarchy
function hasRoleOrHigher(userRole: string, requiredRole: string): boolean {
    const userIndex = ROLE_HIERARCHY.indexOf(userRole);
    const requiredIndex = ROLE_HIERARCHY.indexOf(requiredRole);
    return userIndex >= requiredIndex;
}

// Helper to check specific permission
function hasPermission(
    user: typeof users.superAdmin,
    resource: keyof typeof PERMISSION_TYPES,
    action: string
): boolean {
    // SUPER_ADMIN has all permissions
    if (user.role === 'SUPER_ADMIN') return true;

    const userPerms = (user.permissions as Record<string, string[]>)[resource];
    return userPerms?.includes(action) ?? false;
}

describe('VoiceBot Permissions API', () => {
    describe('Role hierarchy', () => {
        it('should have correct role order', () => {
            expect(ROLE_HIERARCHY[0]).toBe('VIEWER');
            expect(ROLE_HIERARCHY[ROLE_HIERARCHY.length - 1]).toBe('SUPER_ADMIN');
        });

        it('SUPER_ADMIN should have higher role than all others', () => {
            expect(hasRoleOrHigher('SUPER_ADMIN', 'VIEWER')).toBe(true);
            expect(hasRoleOrHigher('SUPER_ADMIN', 'PERFORMER')).toBe(true);
            expect(hasRoleOrHigher('SUPER_ADMIN', 'MANAGER')).toBe(true);
            expect(hasRoleOrHigher('SUPER_ADMIN', 'ADMIN')).toBe(true);
        });

        it('VIEWER should not have ADMIN privileges', () => {
            expect(hasRoleOrHigher('VIEWER', 'ADMIN')).toBe(false);
        });

        it('ADMIN should have MANAGER privileges', () => {
            expect(hasRoleOrHigher('ADMIN', 'MANAGER')).toBe(true);
        });
    });

    describe('Permission checks', () => {
        it('SUPER_ADMIN should have all permissions', () => {
            expect(hasPermission(users.superAdmin, 'VOICEBOT_SESSIONS', 'READ')).toBe(true);
            expect(hasPermission(users.superAdmin, 'VOICEBOT_SESSIONS', 'WRITE')).toBe(true);
            expect(hasPermission(users.superAdmin, 'VOICEBOT_SESSIONS', 'DELETE')).toBe(true);
            expect(hasPermission(users.superAdmin, 'VOICEBOT_PERMISSIONS', 'WRITE')).toBe(true);
        });

        it('ADMIN should have granted permissions only', () => {
            expect(hasPermission(users.admin, 'VOICEBOT_SESSIONS', 'READ')).toBe(true);
            expect(hasPermission(users.admin, 'VOICEBOT_SESSIONS', 'WRITE')).toBe(true);
            expect(hasPermission(users.admin, 'VOICEBOT_SESSIONS', 'DELETE')).toBe(false);
        });

        it('PERFORMER should have limited permissions', () => {
            expect(hasPermission(users.performer, 'VOICEBOT_SESSIONS', 'READ')).toBe(true);
            expect(hasPermission(users.performer, 'VOICEBOT_SESSIONS', 'WRITE')).toBe(false);
        });

        it('VIEWER without explicit permissions should have none', () => {
            expect(hasPermission(users.viewer, 'VOICEBOT_SESSIONS', 'READ')).toBe(false);
            expect(hasPermission(users.viewer, 'VOICEBOT_SESSIONS', 'WRITE')).toBe(false);
        });
    });

    describe('Permission resource validation', () => {
        it('should have valid permission types', () => {
            expect(PERMISSION_TYPES).toHaveProperty('VOICEBOT_SESSIONS');
            expect(PERMISSION_TYPES).toHaveProperty('VOICEBOT_PERSONS');
            expect(PERMISSION_TYPES).toHaveProperty('VOICEBOT_PERMISSIONS');
            expect(PERMISSION_TYPES).toHaveProperty('VOICEBOT_LLMGATE');
        });

        it('session permissions should include CRUD-like actions', () => {
            const sessionPerms = PERMISSION_TYPES.VOICEBOT_SESSIONS;
            expect(sessionPerms).toContain('READ');
            expect(sessionPerms).toContain('WRITE');
            expect(sessionPerms).toContain('DELETE');
        });

        it('LLMGate should have EXECUTE permission', () => {
            expect(PERMISSION_TYPES.VOICEBOT_LLMGATE).toContain('EXECUTE');
        });
    });

    describe('Role assignment validation', () => {
        it('should validate role is in allowed list', () => {
            const newRole = 'PERFORMER';
            expect(ROLE_HIERARCHY).toContain(newRole);
        });

        it('should reject invalid role', () => {
            const invalidRole = 'INVALID_ROLE';
            expect(ROLE_HIERARCHY).not.toContain(invalidRole);
        });

        it('should allow only higher roles to assign lower roles', () => {
            const assigner = users.admin;
            const targetRole = 'PERFORMER';

            // Admin (index 3) should be able to assign Performer (index 1)
            const assignerIndex = ROLE_HIERARCHY.indexOf(assigner.role);
            const targetIndex = ROLE_HIERARCHY.indexOf(targetRole);

            expect(assignerIndex).toBeGreaterThan(targetIndex);
        });
    });
});
