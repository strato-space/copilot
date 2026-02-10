import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import { google } from 'googleapis';
import { GoogleSpreadsheet } from 'google-spreadsheet';

interface ServiceAccountCredentials {
    client_email: string;
    private_key: string;
}

const getCredentials = (): ServiceAccountCredentials => {
    const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (json) {
        return JSON.parse(json) as ServiceAccountCredentials;
    }

    const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    if (!filePath) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_PATH is not configured');
    }

    const resolvedPath = resolve(filePath);
    const raw = readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(raw) as ServiceAccountCredentials;
};

export const createServiceAccountAuth = (): JWT => {
    const creds = getCredentials();
    return new JWT({
        email: creds.client_email,
        key: creds.private_key,
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
