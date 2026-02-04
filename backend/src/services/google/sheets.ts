import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet, type GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import path from 'path';
import fs from 'fs';

interface GoogleCredentials {
    client_email: string;
    private_key: string;
}

let serviceAccountAuth: JWT | null = null;

/**
 * Load Google service account credentials from file
 */
const loadCredentials = (): GoogleCredentials => {
    const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
        ?? path.join(process.cwd(), 'google_service_account.json');

    if (!fs.existsSync(credPath)) {
        throw new Error(`Google service account file not found: ${credPath}`);
    }

    const content = fs.readFileSync(credPath, 'utf-8');
    return JSON.parse(content) as GoogleCredentials;
};

/**
 * Get or create the Google Auth JWT client
 */
export const getGoogleAuth = (): JWT => {
    if (serviceAccountAuth) {
        return serviceAccountAuth;
    }

    const credentials = loadCredentials();

    serviceAccountAuth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/documents',
        ],
    });

    return serviceAccountAuth;
};

/**
 * Load a Google Spreadsheet by ID
 * @param sheetId - The spreadsheet ID from the URL
 */
export const loadSpreadsheet = async (sheetId: string): Promise<GoogleSpreadsheet> => {
    const auth = getGoogleAuth();
    const doc = new GoogleSpreadsheet(sheetId, auth);
    await doc.loadInfo();
    return doc;
};

/**
 * Get a worksheet by index or title
 */
export const getWorksheet = async (
    doc: GoogleSpreadsheet,
    indexOrTitle: number | string
): Promise<GoogleSpreadsheetWorksheet> => {
    if (typeof indexOrTitle === 'number') {
        const sheet = doc.sheetsByIndex[indexOrTitle];
        if (!sheet) {
            throw new Error(`Worksheet not found at index: ${indexOrTitle}`);
        }
        return sheet;
    }
    const sheet = doc.sheetsByTitle[indexOrTitle];
    if (!sheet) {
        throw new Error(`Worksheet not found: ${indexOrTitle}`);
    }
    return sheet;
};

/**
 * Read all rows from a worksheet
 */
export const readAllRows = async (
    sheet: GoogleSpreadsheetWorksheet
): Promise<Record<string, string | number | boolean>[]> => {
    const rows = await sheet.getRows();
    return rows.map((row) => row.toObject());
};

/**
 * Append a row to a worksheet
 */
export const appendRow = async (
    sheet: GoogleSpreadsheetWorksheet,
    data: Record<string, string | number | boolean>
): Promise<void> => {
    await sheet.addRow(data);
};

/**
 * Update cells in a worksheet
 */
export const updateCells = async (
    sheet: GoogleSpreadsheetWorksheet,
    range: string,
    values: (string | number | boolean)[][]
): Promise<void> => {
    await sheet.loadCells(range);

    // Parse range like A1:B5
    const match = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!match || !match[1] || !match[2]) {
        throw new Error(`Invalid range format: ${range}`);
    }

    const startCol = match[1].charCodeAt(0) - 65;
    const startRow = parseInt(match[2], 10) - 1;

    for (let r = 0; r < values.length; r++) {
        const row = values[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = sheet.getCell(startRow + r, startCol + c);
            cell.value = row[c] ?? null;
        }
    }

    await sheet.saveUpdatedCells();
};

export default {
    getGoogleAuth,
    loadSpreadsheet,
    getWorksheet,
    readAllRows,
    appendRow,
    updateCells,
};
