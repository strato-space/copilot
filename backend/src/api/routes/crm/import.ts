import { Router, type Request, type Response } from 'express';
import { getLogger } from '../../../utils/logger.js';
import { loadSpreadsheet, getWorksheet, readAllRows } from '../../../services/google/sheets.js';

const router = Router();
const logger = getLogger();

/**
 * Import data from Google Sheet
 * POST /api/crm/import/google_sheet
 */
router.post('/google_sheet', async (req: Request, res: Response) => {
    try {
        const sheetId = req.body.sheet_id as string;
        const sheetName = req.body.sheet_name as string | undefined;

        if (!sheetId) {
            res.status(400).json({ error: 'sheet_id is required' });
            return;
        }

        // Load the spreadsheet
        const doc = await loadSpreadsheet(sheetId);

        // Get specific worksheet or first one
        const sheet = sheetName
            ? await getWorksheet(doc, sheetName)
            : doc.sheetsByIndex[0];

        if (!sheet) {
            res.status(404).json({ error: 'Worksheet not found' });
            return;
        }

        // Read all rows
        const rows = await readAllRows(sheet);

        res.status(200).json({
            title: doc.title,
            sheet: sheet.title,
            rowCount: rows.length,
            rows,
        });
    } catch (error) {
        logger.error('Error importing from Google Sheet:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
