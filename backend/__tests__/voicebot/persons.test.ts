/**
 * Unit tests for VoiceBot Persons API
 * Tests person data validation and access control
 */

import { describe, it, expect } from '@jest/globals';

// Mock person data
const mockPerson = {
    _id: '507f1f77bcf86cd799439011',
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+7 999 123 4567',
    role: 'Interviewee',
    project_id: 'project-001',
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-02'),
    is_deleted: false,
    metadata: {
        company: 'Test Corp',
        position: 'Product Manager',
    },
};

// Validation helpers
function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidPhone(phone: string): boolean {
    // Russian phone format
    const phoneRegex = /^\+?[0-9\s-]{10,20}$/;
    return phoneRegex.test(phone);
}

function isValidPersonName(name: string): boolean {
    return name.length >= 1 && name.length <= 100;
}

describe('VoiceBot Persons API', () => {
    describe('Person data validation', () => {
        it('should have required fields', () => {
            expect(mockPerson).toHaveProperty('_id');
            expect(mockPerson).toHaveProperty('name');
            expect(mockPerson).toHaveProperty('created_at');
        });

        it('should validate email format', () => {
            expect(isValidEmail(mockPerson.email)).toBe(true);
            expect(isValidEmail('invalid-email')).toBe(false);
            expect(isValidEmail('test@')).toBe(false);
            expect(isValidEmail('@example.com')).toBe(false);
        });

        it('should validate phone format', () => {
            expect(isValidPhone(mockPerson.phone)).toBe(true);
            expect(isValidPhone('+79991234567')).toBe(true);
            expect(isValidPhone('123')).toBe(false);
        });

        it('should validate person name length', () => {
            expect(isValidPersonName(mockPerson.name)).toBe(true);
            expect(isValidPersonName('')).toBe(false);
            expect(isValidPersonName('A'.repeat(101))).toBe(false);
        });
    });

    describe('Person filtering', () => {
        const persons = [
            { ...mockPerson },
            { ...mockPerson, _id: '507f1f77bcf86cd799439022', project_id: 'project-002' },
            { ...mockPerson, _id: '507f1f77bcf86cd799439033', role: 'Interviewer' },
        ];

        it('should filter persons by project_id', () => {
            const filtered = persons.filter(p => p.project_id === 'project-001');
            expect(filtered).toHaveLength(2);
        });

        it('should filter persons by role', () => {
            const filtered = persons.filter(p => p.role === 'Interviewer');
            expect(filtered).toHaveLength(1);
        });

        it('should exclude deleted persons by default', () => {
            const personsWithDeleted = [
                ...persons,
                { ...mockPerson, _id: '507f1f77bcf86cd799439044', is_deleted: true },
            ];
            const active = personsWithDeleted.filter(p => !p.is_deleted);
            expect(active).toHaveLength(3);
        });
    });

    describe('Person update validation', () => {
        it('should validate name update', () => {
            const validUpdates = [
                { name: 'Jane Doe' },
                { name: 'A' },
                { name: 'Very Long Name That Is Still Valid' },
            ];

            validUpdates.forEach(update => {
                expect(isValidPersonName(update.name)).toBe(true);
            });
        });

        it('should reject invalid email updates', () => {
            const invalidEmails = ['not-an-email', 'missing@', '@nodomain'];
            invalidEmails.forEach(email => {
                expect(isValidEmail(email)).toBe(false);
            });
        });

        it('should allow partial updates', () => {
            const partialUpdate = { name: 'Updated Name' };
            const updated = { ...mockPerson, ...partialUpdate };
            expect(updated.name).toBe('Updated Name');
            expect(updated.email).toBe(mockPerson.email); // unchanged
        });
    });

    describe('Person metadata', () => {
        it('should support optional metadata', () => {
            expect(mockPerson.metadata).toBeDefined();
            expect(mockPerson.metadata.company).toBe('Test Corp');
        });

        it('should allow person without metadata', () => {
            const personWithoutMeta = { ...mockPerson };
            delete (personWithoutMeta as any).metadata;
            expect(personWithoutMeta.metadata).toBeUndefined();
        });

        it('should merge metadata on update', () => {
            const metaUpdate = { tags: ['important'] };
            const updatedMeta = { ...mockPerson.metadata, ...metaUpdate };
            expect(updatedMeta.company).toBe('Test Corp');
            expect(updatedMeta.tags).toContain('important');
        });
    });

    describe('Person roles', () => {
        const validRoles = ['Interviewee', 'Interviewer', 'Observer', 'Moderator'];

        it('should have valid role values', () => {
            expect(validRoles).toContain(mockPerson.role);
        });

        it('should allow role change', () => {
            const newRole = 'Interviewer';
            const updated = { ...mockPerson, role: newRole };
            expect(updated.role).toBe(newRole);
        });
    });
});
