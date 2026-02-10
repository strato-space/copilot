import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { buildSpreadsheetUrl, createServiceAccountAuth } from '../../src/services/reports/googleDrive.js';

const ORIGINAL_ENV = { ...process.env };

const FAKE_SERVICE_ACCOUNT = {
    client_email: 'test@example.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nFAKEKEY\n-----END PRIVATE KEY-----\n',
};

describe('Reports Google Drive helpers', () => {
    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        delete process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('buildSpreadsheetUrl should return Google Sheets URL', () => {
        const url = buildSpreadsheetUrl('sheet123');
        expect(url).toBe('https://docs.google.com/spreadsheets/d/sheet123/edit');
    });

    it('createServiceAccountAuth should throw when credentials missing', () => {
        expect(() => createServiceAccountAuth()).toThrow('GOOGLE_SERVICE_ACCOUNT_PATH is not configured');
    });

    it('createServiceAccountAuth should accept JSON credentials', () => {
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_SERVICE_ACCOUNT);
        const auth = createServiceAccountAuth();
        expect(auth).toBeDefined();
    });
});
