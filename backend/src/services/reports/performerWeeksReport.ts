import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import _ from 'lodash';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

import { COLLECTIONS } from '../../constants.js';
import { createServiceAccountAuth, createSpreadsheet, loadSpreadsheet, buildSpreadsheetUrl } from './googleDrive.js';
import type { PerformerWeeksReportParams, ReportResult } from './types.js';

import 'dayjs/locale/en.js';

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(weekOfYear);

type WorkHourRecord = {
    ticket_id: string;
    date_timestamp: number;
    work_hours: number;
    description?: string;
};

type TicketRecord = {
    id: string;
    project?: string;
    name?: string;
    notion_url?: string;
    deadline?: string;
    priority?: string;
    status?: string;
    created_at?: string | number;
    hours_data?: Record<string, Array<WorkHourRecord>>;
};

type PerformerRecord = {
    _id: ObjectId;
    id?: string;
    name?: string;
    real_name?: string;
    drive_folder_id?: string;
};

const setWeekStart = (): void => {
    dayjs.locale('en');
    const localeData = (dayjs as unknown as { Ls?: Record<string, { weekStart?: number }> }).Ls;
    if (localeData?.en) {
        localeData.en.weekStart = 1;
    }
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const indexesToA1 = (row: number, column: number): string => {
    const columns = [
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
        'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    ];
    return `${columns[column]}${row + 1}`;
};

export const generatePerformerWeeksReport = async (
    params: PerformerWeeksReportParams,
    db: Db,
    logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
): Promise<ReportResult> => {
    setWeekStart();

    if (!params.performerId || !params.startDate || !params.endDate) {
        throw new Error('Missing required parameters');
    }

    const reportStart = dayjs(params.startDate).startOf('day');
    const reportEnd = dayjs(params.endDate).endOf('day');

    const performer = await db.collection<PerformerRecord>(COLLECTIONS.PERFORMERS).findOne({
        $or: [
            { id: params.performerId },
            { _id: new ObjectId(params.performerId) },
        ],
    });

    if (!performer) {
        throw new Error('Performer not found');
    }

    if (!performer.drive_folder_id) {
        throw new Error('Performer drive folder is not configured');
    }

    const auth = createServiceAccountAuth();
    const fileTitle = `Отчет_задачи_по_исполнителю_${(performer.name ?? performer.real_name ?? 'performer').replaceAll(' ', '_')}_${reportStart.format('DD.MM')}_${reportEnd.format('DD.MM')}_${Date.now()}`;

    const spreadsheetId = await createSpreadsheet(performer.drive_folder_id, fileTitle, auth);
    const doc = await loadSpreadsheet(spreadsheetId, auth);
    const sheet = doc.sheetsByIndex[0];
    if (!sheet) {
        throw new Error('Spreadsheet has no sheets');
    }

    logger.info('Preparing report:', params);

    const works = await db.collection<WorkHourRecord>(COLLECTIONS.WORK_HOURS).find({
        date_timestamp: { $gt: reportStart.unix(), $lt: reportEnd.unix() },
        created_by: params.performerId,
    }).toArray();

    const ticketsData = await db.collection<TicketRecord>(COLLECTIONS.TASKS).find({
        id: { $in: works.map((work) => work.ticket_id) },
    }).toArray();

    const tickets = _.reduce(ticketsData, (result, obj) => {
        result[obj.id] = obj;
        return result;
    }, {} as Record<string, TicketRecord>);

    let currentDate = reportStart.clone();
    let weeksMap: Record<string, string[]> = {};
    const daysArray: string[] = [];

    while (!currentDate.isAfter(reportEnd, 'day')) {
        const weekKey = `${currentDate.year()}-${currentDate.week()}`;
        const day = currentDate.format('YYYY-MM-DD');
        if (!weeksMap[weekKey]) weeksMap[weekKey] = [];
        weeksMap[weekKey].push(day);
        daysArray.push(day);
        currentDate = currentDate.add(1, 'day');
    }

    const weeks = Object.values(weeksMap);

    for (const work of works) {
        try {
            const ticket = tickets[work.ticket_id];
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

    let rowsCount = 0;
    type WeekRow = Record<string, string | number | Record<string, string>> & { week_days_notes: Record<string, string> };
    const weeksRows: Array<{ rows: WeekRow[]; week_days: Record<string, string> }> = [];

    for (const weekDays of weeks) {
        const weekData: WeekRow[] = [];
        let isFirstTask = true;
        const weekStart = dayjs(weekDays[0]).startOf('week').add(12, 'hours').format('DD.MM.YY');
        const weekEnd = dayjs(weekDays[0]).endOf('week').add(12, 'hours').format('DD.MM.YY');

        for (const ticket of Object.values(tickets)) {
            const hoursByDay = _.reduce(Object.entries(ticket.hours_data ?? {}), (result, [day, data]) => {
                result[day] = _.round(_.reduce(data, (sum, wh) => sum + wh.work_hours, 0.0), 1);
                return result;
            }, {} as Record<string, number>);

            const notesByDay = _.reduce(Object.entries(ticket.hours_data ?? {}), (result, [day, data]) => {
                result[day] = _.reduce(data, (notes, wh) => (wh.description ? `${notes}${wh.description}\n` : notes), '');
                return result;
            }, {} as Record<string, string>);

            const weekDaysHours: Record<string, number | string> = {};
            const weekDaysNotes: Record<string, string> = {};

            for (const [day, hours] of Object.entries(hoursByDay)) {
                if (weekDays.includes(day)) {
                    const dayOfWeek = dayjs(day).format('dd');
                    weekDaysHours[dayOfWeek] = hours > 0.01 ? hours : '';
                    weekDaysNotes[dayOfWeek] = notesByDay[day] ? notesByDay[day] : '';
                }
            }

            const weekTotalTime = _.reduce(Object.values(weekDaysHours), (result, time) => result + Number(time || 0), 0.0);
            if (weekTotalTime < 0.01) continue;

            const newRow: WeekRow = {
                Period: isFirstTask ? `${weekStart} - ${weekEnd}` : '',
                Project: ticket.project ?? '',
                'Task type': '',
                'Task name': ticket.name ?? '',
                'Task link': ticket.notion_url ?? '',
                'Prior or\nDeadline': ticket.deadline ?? ticket.priority ?? '',
                Status: ticket.status ?? '',
                'Created\ndate': ticket.created_at ? dayjs(ticket.created_at).format('DD.MM.YYYY') : '',
                '🕔 Time\nfact': '',
                ...weekDaysHours,
                week_days_notes: weekDaysNotes,
            };

            rowsCount++;
            weekData.push(newRow);
            isFirstTask = false;
        }

        if (weekData.length < 1) {
            weekData.push({
                Period: isFirstTask ? `${weekStart} - ${weekEnd}` : '',
                Project: '',
                'Task type': '',
                'Task name': 'не было задач',
                'Task link': '',
                'Prior or\nDeadline': '',
                Status: '',
                'Created\ndate': '',
                '🕔 Time\nfact': '',
                Mo: '',
                Tu: '',
                We: '',
                Th: '',
                Fr: '',
                Sa: '',
                Su: '',
                week_days_notes: {},
            });
            rowsCount++;
        }

        const weekDaysLabels = _.reduce(weekDays, (result, day) => {
            const dw = dayjs(day).format('dd');
            result[dw] = dayjs(day).format('DD.MM');
            return result;
        }, {} as Record<string, string>);

        weeksRows.push({ rows: weekData, week_days: weekDaysLabels });
    }

    rowsCount = 2 + rowsCount + weeksRows.length * 2 + 10;

    const head = [
        'Period', 'Project', 'Task type', 'Task name', 'Task link',
        'Prior or\nDeadline', 'Status', 'Created\ndate',
        'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su',
        '🕔 Time\nfact', '💪 Score', 'Time\nest.', 'Motiv', 'Effect', 'Timing', 'Commentary',
    ];

    await sheet.loadCells(`A1:Z${rowsCount}`);

    const columnsToStyle: Record<'pre_head' | 'period_column' | 'head' | 'dates_row' | 'dates' | 'tasks' | 'totals' | 'tasks_totals' | 'tasks_summ', number[]> = {
        pre_head: [0],
        period_column: [0],
        head: [],
        dates_row: [],
        dates: [],
        tasks: [],
        totals: [],
        tasks_totals: [],
        tasks_summ: [],
    };

    const rowsToStyle: Record<'pre_head' | 'period_column' | 'head' | 'dates_row' | 'dates' | 'tasks' | 'totals' | 'tasks_totals' | 'tasks_summ', number[]> = {
        pre_head: [0],
        period_column: [],
        head: [1],
        dates_row: [],
        dates: [],
        tasks: [],
        totals: [],
        tasks_totals: [],
        tasks_summ: [],
    };

    const stylesTemplate = {
        pre_head: {
            textFormat: {
                fontSize: 14,
                italic: true,
            },
        },
        head: {
            backgroundColor: { red: 67 / 255, green: 67 / 255, blue: 67 / 255 },
            textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
            },
            verticalAlignment: 'MIDDLE',
        },
        dates_row: {
            backgroundColor: { red: 217 / 255, green: 217 / 255, blue: 217 / 255 },
        },
        dates: {
            backgroundColor: { red: 243 / 255, green: 243 / 255, blue: 243 / 255 },
            textRotation: { angle: 90 },
        },
        totals: {
            backgroundColor: { red: 255 / 255, green: 242 / 255, blue: 204 / 255 },
            textFormat: { bold: true },
        },
        tasks_totals: {
            backgroundColor: { red: 255 / 255, green: 242 / 255, blue: 204 / 255 },
            textFormat: { bold: true },
            horizontalAlignment: 'CENTER',
        },
        tasks_summ: {
            textFormat: { fontSize: 13, bold: true },
            horizontalAlignment: 'CENTER',
        },
        period_column: {
            backgroundColor: { red: 243 / 255, green: 243 / 255, blue: 243 / 255 },
            verticalAlignment: 'MIDDLE',
            horizontalAlignment: 'CENTER',
            textRotation: { angle: 90 },
        },
    };

    const headColors: Record<string, { red: number; green: number; blue: number }> = {
        '🕔 Time\nfact': { red: 153 / 255, green: 0 / 255, blue: 255 / 255 },
        '💪 Score': { red: 0 / 255, green: 0 / 255, blue: 255 / 255 },
        'Time\nest.': { red: 142 / 255, green: 124 / 255, blue: 195 / 255 },
        Motiv: { red: 111 / 255, green: 168 / 255, blue: 220 / 255 },
        Effect: { red: 111 / 255, green: 168 / 255, blue: 220 / 255 },
        Timing: { red: 111 / 255, green: 168 / 255, blue: 220 / 255 },
        Commentary: { red: 67 / 255, green: 67 / 255, blue: 67 / 255 },
    };

    const columnsWidth = {
        dates: { pixelSize: 30, startIndex: 0, endIndex: 0 },
        created_date: { pixelSize: 70, startIndex: 0, endIndex: 0 },
        time_fact: { pixelSize: 70, startIndex: 0, endIndex: 0 },
        period_column: { pixelSize: 50, startIndex: 0, endIndex: 1 },
        commentary: {
            pixelSize: 250,
            startIndex: _.indexOf(head, 'Commentary'),
            endIndex: _.indexOf(head, 'Commentary') + 1,
        },
    };

    const mergeCells: Array<{ startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number }> = [];

    let currentRow = 0;
    sheet.getCell(currentRow, 0).value = `Performer Name: ${performer.name ?? performer.real_name ?? ''}`;
    sheet.getCell(currentRow, 12).value = `Last update: ${dayjs().format('DD.MM.YYYY')}`;
    currentRow++;

    for (let index = 0; index < head.length; index++) {
        const column = head[index];
        if (!column) continue;
        sheet.getCell(currentRow, index).value = column;
    }
    currentRow++;

    for (const week of weeksRows) {
        const rows = week.rows;
        const days = week.week_days;
        for (let index = 0; index < head.length; index++) {
            const column = head[index];
            if (!column) continue;
            if (Object.keys(days).includes(column)) {
                sheet.getCell(currentRow, index).value = days[column];
                columnsToStyle.dates.push(index);
            }
            columnsToStyle.head.push(index);
            columnsToStyle.dates_row.push(index);
        }
        rowsToStyle.dates.push(currentRow);
        rowsToStyle.dates_row.push(currentRow);
        currentRow++;

        const rStart = currentRow;
        for (const row of rows) {
            const cStart = _.indexOf(head, 'Mo');
            const cEnd = _.indexOf(head, 'Su');
            row['🕔 Time\nfact'] = `=SUM(${indexesToA1(currentRow, cStart)}:${indexesToA1(currentRow, cEnd)})`;
            for (let index = 0; index < head.length; index++) {
                const column = head[index];
                if (!column) continue;
                const cellValue = row[column];
                sheet.getCell(currentRow, index).value = typeof cellValue === 'object' ? '' : cellValue;
                if (!_.isUndefined(row.week_days_notes?.[column])) {
                    sheet.getCell(currentRow, index).note = row.week_days_notes?.[column];
                }
            }
            rowsToStyle.tasks.push(currentRow);
            rowsToStyle.tasks_totals.push(currentRow);
            currentRow++;
        }

        const rEnd = currentRow - 1;

        mergeCells.push({
            startRowIndex: rStart,
            endRowIndex: rEnd + 1,
            startColumnIndex: 0,
            endColumnIndex: 1,
        });

        rowsToStyle.period_column.push(rStart);

        if (columnsWidth.dates.startIndex === 0 && columnsWidth.dates.endIndex === 0) {
            const cStart = _.indexOf(head, 'Mo');
            const cEnd = _.indexOf(head, 'Su');
            columnsWidth.dates.startIndex = cStart;
            columnsWidth.dates.endIndex = cEnd + 1;
            columnsWidth.time_fact.startIndex = cEnd + 1;
            columnsWidth.time_fact.endIndex = cEnd + 2;
            columnsWidth.created_date.startIndex = _.indexOf(head, 'Created\ndate');
            columnsWidth.created_date.endIndex = _.indexOf(head, 'Created\ndate') + 1;
        }

        for (let index = 0; index < head.length; index++) {
            const column = head[index];
            if (!column) continue;
            if (Object.keys(days).includes(column)) {
                sheet.getCell(currentRow, index).value = `=SUM(${indexesToA1(rStart, index)}:${indexesToA1(rEnd, index)})`;
                columnsToStyle.totals.push(index);
            }
        }

        const cIndex = _.indexOf(head, '🕔 Time\nfact');
        sheet.getCell(currentRow, cIndex).value = `=SUM(${indexesToA1(rStart, cIndex)}:${indexesToA1(rEnd, cIndex)})`;
        columnsToStyle.tasks_totals.push(cIndex);
        columnsToStyle.tasks_summ.push(cIndex);
        rowsToStyle.totals.push(currentRow);
        rowsToStyle.tasks_summ.push(currentRow);
        currentRow++;
    }

    const styleKeys = Object.keys(stylesTemplate) as Array<keyof typeof stylesTemplate>;
    for (const key of styleKeys) {
        for (const row of rowsToStyle[key]) {
            for (const col of columnsToStyle[key]) {
                for (const style of Object.keys(stylesTemplate[key]) as Array<keyof typeof stylesTemplate[typeof key]>) {
                    const cell = sheet.getCell(row, col) as unknown as Record<string, unknown>;
                    cell[style as string] = stylesTemplate[key][style];
                }
            }
        }
    }

    for (const [key, bgcolor] of Object.entries(headColors)) {
        const row = 1;
        const col = _.indexOf(head, key);
        sheet.getCell(row, col).backgroundColor = bgcolor;
    }

    await sheet.saveUpdatedCells();

    for (const key of Object.keys(columnsWidth)) {
        const props = columnsWidth[key as keyof typeof columnsWidth];
        const dimensionProps = { pixelSize: props.pixelSize } as Parameters<typeof sheet.updateDimensionProperties>[1];
        await sheet.updateDimensionProperties(
            'COLUMNS',
            dimensionProps,
            { startIndex: props.startIndex, endIndex: props.endIndex }
        );
    }

    for (const range of mergeCells) {
        await sheet.mergeCells(range, 'MERGE_ALL');
        await delay(1000);
    }

    return {
        url: buildSpreadsheetUrl(spreadsheetId),
        documentId: spreadsheetId,
        sheetId: sheet.sheetId,
    };
};
