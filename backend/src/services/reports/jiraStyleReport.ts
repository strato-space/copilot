import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import _ from 'lodash';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

import { COLLECTIONS } from '../../constants.js';
import { createServiceAccountAuth, createSheetsClient, createSpreadsheet, loadSpreadsheet, buildSpreadsheetUrl } from './googleDrive.js';
import type { JiraStyleReportParams, ReportResult } from './types.js';

import 'dayjs/locale/en.js';

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(weekOfYear);

type TicketRecord = {
    _id: ObjectId;
    id: string;
    project?: string;
    project_id?: ObjectId | string;
    name?: string;
    performer?: { id?: string; real_name?: string; name?: string } | string | null;
    notion_url?: string;
    status?: string;
    created_at?: string | number;
    hours_data?: Record<string, Array<WorkHourRecord>>;
};

type WorkHourRecord = {
    ticket_db_id?: unknown;
    date_timestamp: number;
    work_hours: number;
    description?: string;
};

type PerformerRecord = {
    id?: string;
    real_name?: string;
    name?: string;
};

type CustomerRecord = {
    _id: ObjectId;
    name: string;
};

type ProjectGroupRecord = {
    _id: ObjectId;
    customer?: ObjectId | string;
};

type ProjectRecord = {
    _id: ObjectId;
    name: string;
    project_group?: ObjectId | string;
};

const JIRA_REPORTS_FOLDER_ID = process.env.REPORTS_JIRA_FOLDER_ID ?? '1Y8KaMhqi9HeiNUgiJtvYsdzOvMQvS8KD';

const setWeekStart = (): void => {
    dayjs.locale('en');
    const localeData = (dayjs as unknown as { Ls?: Record<string, { weekStart?: number }> }).Ls;
    if (localeData?.en) {
        localeData.en.weekStart = 1;
    }
};

const indexesToA1 = (row: number, column: number): string => {
    const columns = [
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
        'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB',
        'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP',
        'AQ', 'AR', 'AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ',
    ];
    return `${columns[column]}${row + 1}`;
};

const normalizeTicketDbId = (value: unknown): string | null => {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : null;
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.$oid === 'string' && ObjectId.isValid(record.$oid)) {
            return new ObjectId(record.$oid).toHexString();
        }
    }
    return null;
};

export const generateJiraStyleReport = async (
    params: JiraStyleReportParams,
    db: Db,
    logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
): Promise<ReportResult> => {
    setWeekStart();

    if (!params.customerId || !params.startDate || !params.endDate) {
        throw new Error('Missing required parameters');
    }

    const reportStart = dayjs(params.startDate).startOf('day');
    const reportEnd = dayjs(params.endDate).endOf('day');

    if (!ObjectId.isValid(params.customerId)) {
        throw new Error('Invalid customer id');
    }

    const customer = await db.collection<CustomerRecord>(COLLECTIONS.CUSTOMERS).findOne({
        _id: new ObjectId(params.customerId),
    });
    if (!customer) {
        throw new Error('Customer not found');
    }

    const projectGroups = await db.collection<ProjectGroupRecord>(COLLECTIONS.PROJECT_GROUPS).find({
        customer: customer._id,
    }).toArray();
    const projects = await db.collection<ProjectRecord>(COLLECTIONS.PROJECTS).find({
        project_group: { $in: projectGroups.map((group) => group._id) },
    }).toArray();
    const projectIds = projects.map((project) => project._id);

    const auth = createServiceAccountAuth();
    const sheetsClient = createSheetsClient(auth);

    const customerName = customer.name.replaceAll(' ', '_');
    const fileTitle = `Отчет_задачи_по_клиенту_jira_format_${customerName}_${reportStart.format('DD.MM')}_${reportEnd.format('DD.MM')}_${Date.now()}`;

    const spreadsheetId = await createSpreadsheet(JIRA_REPORTS_FOLDER_ID, fileTitle, auth);
    const doc = await loadSpreadsheet(spreadsheetId, auth);
    const sheet = doc.sheetsByIndex[0];
    if (!sheet) {
        throw new Error('Spreadsheet has no sheets');
    }

    logger.info('Sheet url:', buildSpreadsheetUrl(spreadsheetId));

    const ticketsData = await db.collection<TicketRecord>(COLLECTIONS.TASKS).find({
        project_id: { $in: projectIds },
    }).toArray();

    const ticketDbIdsAsString = ticketsData.map((ticket) => ticket._id.toHexString());
    const ticketDbIdCandidates: Array<string | ObjectId> = _.uniqBy(
        [...ticketDbIdsAsString, ...ticketsData.map((ticket) => ticket._id)],
        (value) => value.toString()
    );

    const works = await db.collection<WorkHourRecord>(COLLECTIONS.WORK_HOURS).find({
        date_timestamp: { $gt: reportStart.unix(), $lt: reportEnd.unix() },
        ticket_db_id: { $in: ticketDbIdCandidates },
    }).toArray();

    const tickets = _.reduce(ticketsData, (result, obj) => {
        result[obj._id.toHexString()] = obj;
        return result;
    }, {} as Record<string, TicketRecord>);

    const performersData = await db.collection<PerformerRecord>(COLLECTIONS.PERFORMERS).find().toArray();
    const performers = _.reduce(performersData, (result, obj) => {
        if (obj.id) {
            result[obj.id] = obj;
        }
        return result;
    }, {} as Record<string, PerformerRecord>);

    let currentDate = reportStart.clone();
    const daysArray: string[] = [];

    while (!currentDate.isAfter(reportEnd, 'day')) {
        daysArray.push(currentDate.format('YYYY-MM-DD'));
        currentDate = currentDate.add(1, 'day');
    }

    for (const work of works) {
        try {
            const ticketDbId = normalizeTicketDbId(work.ticket_db_id);
            if (!ticketDbId) continue;
            const ticket = tickets[ticketDbId];
            if (!ticket) continue;
            const key = dayjs.unix(work.date_timestamp).format('YYYY-MM-DD');
            if (!ticket.hours_data) {
                ticket.hours_data = _.reduce(daysArray, (result, dayKey) => {
                    result[dayKey] = [];
                    return result;
                }, {} as Record<string, Array<WorkHourRecord>>);
            }
            if (!ticket.hours_data[key]) ticket.hours_data[key] = [];
            ticket.hours_data[key].push(work);
        } catch (error) {
            logger.error(error);
        }
    }

    for (const [ticketKey, ticket] of Object.entries(tickets)) {
        let toDelete = true;
        if (ticket.hours_data && !_.isEmpty(ticket.hours_data)) {
            const hasWork = _.some(Object.values(ticket.hours_data), (dayData) =>
                _.some(dayData, (wh) => wh.work_hours > 0.001)
            );
            toDelete = !hasWork;
        }
        if (toDelete) {
            delete tickets[ticketKey];
        }
    }

    const daysColumns = daysArray.map((day) => dayjs(day).format('DD.MM'));
    const head = ['Исполнитель', 'Проект', 'Задача', ...daysColumns, 'TotByTask', 'Tot'];

    const columnIndexByName = (columnName: string): number => {
        const index = head.indexOf(columnName);
        if (index === -1) {
            throw new Error(`Column "${columnName}" not found in head`);
        }
        return index;
    };

    const rows: Array<Record<string, string | number>> = [];

    for (const ticket of Object.values(tickets)) {
        const performerValue = typeof ticket.performer === 'object'
            ? ticket.performer
            : null;
        const performerId = performerValue?.id;
        const performerName = performerId && performers[performerId]
            ? performers[performerId]?.real_name ?? performers[performerId]?.name
            : performerValue?.real_name ?? performerValue?.name;

        const row: Record<string, string | number> = {
            'Исполнитель': performerName ?? '',
            'Проект': ticket.project ?? '',
            'Задача': ticket.name ?? '',
            'Task link': ticket.notion_url ?? '',
            'Status': ticket.status ?? '',
            'Created\ndate': ticket.created_at ? dayjs(ticket.created_at).format('DD.MM.YYYY') : '',
        };

        for (const day of daysArray) {
            const dayKey = dayjs(day).format('YYYY-MM-DD');
            if (!ticket.hours_data || !ticket.hours_data[dayKey]) {
                row[dayjs(day).format('DD.MM')] = '';
                row[`${dayjs(day).format('DD.MM')} notes`] = '';
            } else {
                const totalHours = _.reduce(ticket.hours_data[dayKey], (sum, wh) => sum + wh.work_hours, 0);
                row[dayjs(day).format('DD.MM')] = totalHours > 0.01 ? totalHours : '';
                row[`${dayjs(day).format('DD.MM')} notes`] = _.reduce(ticket.hours_data[dayKey], (notes, wh) => {
                    if (wh.description) {
                        return `${notes}${wh.description}\n`;
                    }
                    return notes;
                }, '');
            }
        }

        rows.push(row);
    }

    rows.sort((a, b) => {
        const performerA = String(a['Исполнитель'] ?? '');
        const performerB = String(b['Исполнитель'] ?? '');
        const projectA = String(a['Проект'] ?? '');
        const projectB = String(b['Проект'] ?? '');
        if (performerA < performerB) return -1;
        if (performerA > performerB) return 1;
        if (projectA < projectB) return -1;
        if (projectA > projectB) return 1;
        return 0;
    });

    const rowsByPerformer: Record<string, Array<Record<string, string | number>>> = {};
    for (const row of rows) {
        const performer = String(row['Исполнитель'] ?? '');
        if (!rowsByPerformer[performer]) {
            rowsByPerformer[performer] = [];
        }
        rowsByPerformer[performer].push(row);
    }

    const rowsCount = 2 + rows.length + 20;
    await sheet.resize({ rowCount: rowsCount, columnCount: head.length + 20 });
    await sheet.loadCells({
        startRowIndex: 0,
        endRowIndex: rowsCount,
        startColumnIndex: 0,
        endColumnIndex: head.length + 20,
    });

    const columnsWidth: Record<string, { pixelSize: number; startIndex: number; endIndex: number }> = {
        'Исполнитель': { pixelSize: 160, startIndex: 0, endIndex: 1 },
        'Проект': { pixelSize: 130, startIndex: 0, endIndex: 0 },
        'Задача': { pixelSize: 460, startIndex: 0, endIndex: 0 },
        'TotByTask': { pixelSize: 80, startIndex: 0, endIndex: 0 },
        'Tot': { pixelSize: 80, startIndex: 0, endIndex: 0 },
    };

    for (const dayColumn of daysColumns) {
        columnsWidth[dayColumn] = { pixelSize: 40, startIndex: 0, endIndex: 0 };
    }

    for (const column of Object.keys(columnsWidth)) {
        const index = columnIndexByName(column);
        const config = columnsWidth[column];
        if (!config) continue;
        config.startIndex = index;
        config.endIndex = index + 1;
    }

    const mergeCells: Array<{ startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number }> = [];

    let currentRow = 0;
    sheet.getCell(currentRow, 0).value = `Customer: ${customer.name}`;
    sheet.getCell(currentRow, 4).value = `Period: ${reportStart.format('DD.MM')} - ${reportEnd.format('DD.MM')}`;
    currentRow++;

    for (let index = 0; index < head.length; index++) {
        const column = head[index];
        if (!column) continue;
        sheet.getCell(currentRow, index).value = column;
    }
    currentRow++;

    for (const rowsChunk of Object.values(rowsByPerformer)) {
        const startRow = currentRow;
        const endRow = currentRow + rowsChunk.length - 1;

        mergeCells.push({
            startRowIndex: startRow,
            endRowIndex: endRow + 1,
            startColumnIndex: 0,
            endColumnIndex: 1,
        });

        mergeCells.push({
            startRowIndex: startRow,
            endRowIndex: endRow + 1,
            startColumnIndex: columnIndexByName('Tot'),
            endColumnIndex: columnIndexByName('Tot') + 1,
        });

        for (const row of rowsChunk) {
            for (let index = 0; index < head.length; index++) {
                const column = head[index];
                if (!column) continue;
                if (Object.prototype.hasOwnProperty.call(row, column) && column !== 'Tot' && column !== 'TotByTask') {
                    try {
                        sheet.getCell(currentRow, index).value = row[column];
                        const notesKey = `${column} notes`;
                        if (row[notesKey]) {
                            sheet.getCell(currentRow, index).note = String(row[notesKey]);
                        }
                    } catch (error) {
                        logger.error('Error setting cell value:', error);
                        logger.error('(row, column index):', currentRow, index);
                    }
                }
            }

            const firstDay = _.first(daysColumns) ?? '';
            const lastDay = _.last(daysColumns) ?? '';
            row['TotByTask'] = `=SUM(${indexesToA1(currentRow, columnIndexByName(firstDay))}:${indexesToA1(currentRow, columnIndexByName(lastDay))})`;
            row['Tot'] = `=SUM(${indexesToA1(currentRow, columnIndexByName('TotByTask'))}:${indexesToA1(currentRow + rowsChunk.length - 1, columnIndexByName('TotByTask'))})`;
            sheet.getCell(currentRow, columnIndexByName('TotByTask')).value = row['TotByTask'];
            sheet.getCell(currentRow, columnIndexByName('Tot')).value = row['Tot'];
            currentRow++;
        }
    }

    await sheet.saveUpdatedCells();

    const requests = Object.values(columnsWidth).map((props) => ({
        updateDimensionProperties: {
            range: {
                sheetId: sheet.sheetId,
                dimension: 'COLUMNS',
                startIndex: props.startIndex,
                endIndex: props.endIndex,
            },
            properties: {
                pixelSize: props.pixelSize,
            },
            fields: 'pixelSize',
        },
    }));

    if (requests.length > 0) {
        await sheetsClient.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests },
        });
    }

    const mergeRequests = mergeCells.map((range) => ({
        mergeCells: {
            range: {
                sheetId: sheet.sheetId,
                startRowIndex: range.startRowIndex,
                endRowIndex: range.endRowIndex,
                startColumnIndex: range.startColumnIndex,
                endColumnIndex: range.endColumnIndex,
            },
            mergeType: 'MERGE_ALL',
        },
    }));

    if (mergeRequests.length > 0) {
        await sheetsClient.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: mergeRequests },
        });
    }

    return {
        url: buildSpreadsheetUrl(spreadsheetId),
        documentId: spreadsheetId,
        sheetId: sheet.sheetId,
    };
};
