# Reports Setup (OperOps)

## Google Service Account

1. Copy the service account key file from automation into the copilot repo root:
   - File name: google_service_account.json
2. Ensure it is ignored by Git (already added to .gitignore).
3. Configure the backend environment variable:
   - GOOGLE_SERVICE_ACCOUNT_PATH=./google_service_account.json

## Google Drive Folder

- Jira-style reports are stored in a fixed folder.
- Optional override:
  - REPORTS_JIRA_FOLDER_ID=<drive-folder-id>

## Access Control

- Report generation is restricted to ADMIN/SUPER_ADMIN roles.

## API Endpoints

- POST /api/crm/reports/jira-style
- POST /api/crm/reports/performer-weeks

## Audit Log Collection

- Mongo collection: automation_reports_log
- Stored fields:
  - reportType, params, createdAt, createdBy
  - status, documentId, sheetId, url
  - errorMessage (on failure)
