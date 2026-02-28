import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import { google } from 'googleapis';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { getLogger } from '../../utils/logger.js';

interface ServiceAccountCredentials {
    client_email: string;
    private_key: string;
}

const logger = getLogger();

const parseCredentials = (raw: string, source: string): ServiceAccountCredentials => {
    try {
        const parsed = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
        if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
            throw new Error('missing_required_fields');
        }
        return {
            client_email: parsed.client_email,
            private_key: parsed.private_key,
        };
    } catch (error) {
        logger.error('[google.drive] failed to parse auth payload', {
            source,
            reason: error instanceof Error ? error.message : String(error),
        });
        throw new Error(`Invalid Google service account credentials in ${source}`);
    }
};

const getCredentials = (): ServiceAccountCredentials => {
    const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (json) {
        return parseCredentials(json, 'GOOGLE_SERVICE_ACCOUNT_JSON');
    }

    const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    if (!filePath) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_PATH is not configured');
    }

    const resolvedPath = resolve(filePath);
    const raw = readFileSync(resolvedPath, 'utf-8');
    return parseCredentials(raw, resolvedPath);
};

const normalizePrivateKey = (value: string): string => value
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n')
    .trim();

export const createServiceAccountAuth = (): JWT => {
    const creds = getCredentials();
    return new JWT({
        email: creds.client_email,
        key: normalizePrivateKey(creds.private_key),
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    });
};

export const createDriveClient = (auth: JWT) => google.drive({ version: 'v3', auth });

export const createSheetsClient = (auth: JWT) => google.sheets({ version: 'v4', auth });

export const createSpreadsheet = async (folderId: string, title: string, auth: JWT): Promise<string> => {
    const drive = createDriveClient(auth);
    const response = await drive.files.create({
        requestBody: {
            name: title,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            parents: [folderId],
        },
    });

    const spreadsheetId = response.data.id;
    if (!spreadsheetId) {
        throw new Error('Failed to create spreadsheet');
    }
    return spreadsheetId;
};

export const loadSpreadsheet = async (spreadsheetId: string, auth: JWT): Promise<GoogleSpreadsheet> => {
    const doc = new GoogleSpreadsheet(spreadsheetId, auth);
    await doc.loadInfo();
    return doc;
};

export const buildSpreadsheetUrl = (spreadsheetId: string): string =>
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
