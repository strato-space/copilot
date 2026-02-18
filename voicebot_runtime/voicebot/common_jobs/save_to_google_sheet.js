require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;
const _ = require("lodash");

function resolveBetaTag(rawValue) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) return "";
    const lower = value.toLowerCase();
    if (lower === "false") return "";
    if (lower === "true") return "beta";
    return value;
}

const BETA_TAG = resolveBetaTag(config.VOICE_BOT_IS_BETA);
const IS_BETA = BETA_TAG !== "";

const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require("google-spreadsheet");
const google_creds = require('../../google_service_account.json');
const dayjs = require('dayjs')
const { google } = require('googleapis');
const { delay } = require("../../utils");

const ObjectId = require("mongodb").ObjectId;
const constants = require("../../constants");

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const message_db_id = job_data.message_db_id;
    const session_id = job_data.session_id;
    const sheet_name = job_data.sheet_name;
    const sheet_header = job_data.sheet_header;
    const row_to_save = job_data.row_to_save;
    const processor_key = job_data.processor_key;

    // logger.info('Starting save to Google Sheet job for message:', job_data);

    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({ _id: new ObjectId(session_id) });
    await delay(200);

    const googleServiceAccountAuth = new JWT({
        email: google_creds.client_email,
        key: google_creds.private_key,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/documents'
        ],
    });
    await delay(200);

    let current_spreadsheet_file_id = session.current_spreadsheet_file_id;

    if (!current_spreadsheet_file_id) {
        const SCOPES = ['https://www.googleapis.com/auth/drive'];
        const auth = new google.auth.JWT(
            google_creds.client_email,
            null,
            google_creds.private_key,
            SCOPES
        );
        const drive = google.drive({ version: 'v3', auth });
        await delay(200);
        const fileMetadata = {
            name: `Transcription ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            parents: [IS_BETA ? config.TRANSCRIPTIONS_TEST_FOLDER_ID : config.TRANSCRIPTIONS_FOLDER_ID]
        };
        logger.info('Creating new Google Spreadsheet for transcription...');
        const file = await drive.files.create({
            resource: fileMetadata,
            fields: 'id',
        });
        await delay(200);
        logger.info('Spreadsheet created, id:', file.data.id);
        await delay(2000);
        const spreadsheetId = file.data.id;
        current_spreadsheet_file_id = spreadsheetId;
        logger.info('Spreadsheet created successfully: https://docs.google.com/spreadsheets/d/' + spreadsheetId);
        const spreadsheet_url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

        await tgbot.telegram.sendMessage(
            session.chat_id,
            `Создан файл транскрипции: [Transcription ${dayjs().format('YYYY-MM-DD HH:mm:ss')}](${spreadsheet_url}) `,
            { parse_mode: 'Markdown' }
        );
        await delay(200);

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    current_spreadsheet_file_id: current_spreadsheet_file_id,
                }
            }
        );
        await delay(200);
    }

    logger.info('Loading Google Spreadsheet:', current_spreadsheet_file_id);
    const doc = new GoogleSpreadsheet(current_spreadsheet_file_id, googleServiceAccountAuth);
    await delay(200);
    await doc.loadInfo();
    await delay(200);
    logger.info('Loaded Google Spreadsheet.');
    let sheet = doc.sheetsByTitle[sheet_name];

    if (!sheet) {
        logger.info('Adding sheet: ', sheet_name);
        sheet = await doc.addSheet({ title: sheet_name });
        await delay(200);
        try {
            await sheet.setHeaderRow(sheet_header);
            await delay(200);
            logger.info('Sheet added and header row set.');
        } catch (err) {
            logger.error('Failed to set header row on new sheet:', err);
        }
    }

    const defaultSheet = doc.sheetsByTitle['Sheet1'];
    if (defaultSheet) {
        logger.info('Deleting default Sheet1...');
        await defaultSheet.delete();
        await delay(200);
        logger.info('Default Sheet1 deleted.');
    }

    let headerLoaded = false;
    try {
        await sheet.loadHeaderRow();
        await delay(200);
        headerLoaded = sheet.headerValues && sheet.headerValues.length > 0;
    } catch (err) {
        logger.warn('Failed to load header row, will try to set header row:', err.message);
    }
    if (!headerLoaded) {
        logger.warn('Sheet header is not set, setting header row now.');
        try {
            await sheet.setHeaderRow(sheet_header);
            await delay(200);
            logger.info('Header row set successfully.');
        } catch (err) {
            logger.error('Failed to set header row:', err);
            throw err;
        }
    }

    if (_.isArray(row_to_save)) {
        for (const row of row_to_save) {
            await sheet.addRow(row);
            await delay(200); // Add a small delay to avoid rate limiting
        }
    } else {
        await sheet.addRow(row_to_save);
        await delay(200);
    }

    await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
        { _id: new ObjectId(message_db_id) },
        {
            $set: {
                [`${processor_key}.is_saving`]: false,
                [`${processor_key}.is_saved`]: true
            }
        }
    );
    await delay(200);
};

module.exports = job_handler;
