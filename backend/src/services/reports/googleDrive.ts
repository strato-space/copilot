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
const LOAD_INFO_MAX_ATTEMPTS = 4;
const LOAD_INFO_BASE_DELAY_MS = 250;
const LOAD_INFO_MAX_DELAY_MS = 2000;
const GOOGLE_NO_PROXY_HOSTS = [
    '127.0.0.1',
    'localhost',
    'api.telegram.org',
    'telegram.org',
    '.telegram.org',
    '*.telegram.org',
    'googleapis.com',
    '.googleapis.com',
    'docs.google.com',
    '.google.com',
    'github.com',
    '.github.com',
    'stratospace.fun',
    '.stratospace.fun',
    '*.stratospace.fun',
    '176.124.201.53',
];

type RetryableError = {
    code?: string;
    message?: string;
    response?: {
        status?: number;
    };
};

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

const disableSpreadsheetClientProxy = (doc: GoogleSpreadsheet): void => {
    // google-spreadsheet uses internal axios clients (sheetsApi/driveApi). Explicitly disable proxy
    // to avoid env-level proxy interference on loadInfo() calls.
    doc.sheetsApi.defaults.proxy = false;
    doc.driveApi.defaults.proxy = false;
};

const normalizeNoProxyToken = (token: string): string => token.trim().toLowerCase();

const appendNoProxyHosts = (value: string | undefined): string => {
    const currentTokens = (value ?? '')
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
    const existing = new Set(currentTokens.map(normalizeNoProxyToken));
    const merged = [...currentTokens];

    for (const host of GOOGLE_NO_PROXY_HOSTS) {
        if (!existing.has(normalizeNoProxyToken(host))) {
            merged.push(host);
        }
    }

    return merged.join(',');
};

const ensureGoogleNoProxyEnv = (): void => {
    process.env.NO_PROXY = appendNoProxyHosts(process.env.NO_PROXY);
    process.env.no_proxy = appendNoProxyHosts(process.env.no_proxy);
};

const isRetryableLoadInfoError = (error: unknown): boolean => {
    const candidate = error as RetryableError | undefined;
    const status = candidate?.response?.status;
    if (status === 429 || status === 502 || status === 503 || status === 504) {
        return true;
    }

    const code = String(candidate?.code ?? '').toUpperCase();
    if (code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
        return true;
    }

    const message = String(candidate?.message ?? '').toUpperCase();
    return message.includes('ECONNRESET')
        || message.includes('SOCKET HANG UP')
        || message.includes('ETIMEDOUT')
        || message.includes('EAI_AGAIN');
};

const getLoadInfoBackoffMs = (attempt: number): number =>
    Math.min(LOAD_INFO_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)), LOAD_INFO_MAX_DELAY_MS);

const sleep = async (ms: number): Promise<void> =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export const loadSpreadsheet = async (spreadsheetId: string, auth: JWT): Promise<GoogleSpreadsheet> => {
    ensureGoogleNoProxyEnv();
    const doc = new GoogleSpreadsheet(spreadsheetId, auth);
    disableSpreadsheetClientProxy(doc);

    for (let attempt = 1; attempt <= LOAD_INFO_MAX_ATTEMPTS; attempt++) {
        try {
            await doc.loadInfo();
            return doc;
        } catch (error) {
            const retryable = isRetryableLoadInfoError(error);
            const hasRetriesLeft = attempt < LOAD_INFO_MAX_ATTEMPTS;

            if (!retryable || !hasRetriesLeft) {
                throw error;
            }

            const delayMs = getLoadInfoBackoffMs(attempt);
            logger.warn('[google.drive] loadSpreadsheet loadInfo retrying after transient failure', {
                spreadsheetId,
                attempt,
                delayMs,
                status: (error as RetryableError | undefined)?.response?.status,
                code: (error as RetryableError | undefined)?.code,
            });
            await sleep(delayMs);
        }
    }

    return doc;
};

export const buildSpreadsheetUrl = (spreadsheetId: string): string =>
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
