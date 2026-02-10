export interface ReportResult {
    url: string;
    documentId: string;
    sheetId: number;
}

export interface JiraStyleReportParams {
    projectId: string;
    startDate: string;
    endDate: string;
}

export interface PerformerWeeksReportParams {
    performerId: string;
    startDate: string;
    endDate: string;
}

export interface ReportActor {
    userId: string;
    email?: string;
    name?: string;
    role?: string;
}
