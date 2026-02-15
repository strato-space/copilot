# Plan: Fix collections mismatch (`automation_clients` -> `automation_customers`)

## Status

- As of 2026-02-13 (commit `b9a1389`), Copilot code paths were migrated off the legacy `automation_clients` collection.
- The legacy collection may still exist in MongoDB; consider cleanup only after verifying all environments and flows.

## 1) Observed DB facts (at the time of analysis)

- Collections present: `automation_customers`, `automation_project_groups`, `automation_projects`, `automation_clients` (legacy).
- Counts (MongoDB host redacted):
  - customers: 10
  - project_groups: 19
  - projects: 99
  - clients (legacy): 27
- Document shape examples:
  - `automation_customers`: `name`, `is_active`, `project_groups_ids`
  - `automation_project_groups`: `name`, `is_active`, `projects_ids`
  - `automation_projects`: sample documents had no `customer_id` and no `project_group_id`
- Relationship field checks:
  - `automation_project_groups.customer_id` / `customers_ids` are not used (0 documents)
  - `automation_projects.customer_id` / `project_group_id` / `project_group_ids` are not used (0 documents)

Conclusion: the effective relationship is implemented through id arrays:
`automation_customers.project_groups_ids -> automation_project_groups.projects_ids -> automation_projects`.

## 2) Goal

Replace any usage of the legacy `automation_clients` collection with the current relationship
`automation_customers -> automation_project_groups -> automation_projects` across Copilot (backend + frontend),
without breaking CRM flows and directories.

## 3) Plan (micro-steps)

### Stage A. Inventory current usages

1. Find all mentions of `CLIENTS`, `automation_clients`, `clients` in the Copilot backend.
2. List all API endpoints where client/customer data is returned/used:
   - CRM dictionary
   - CRM tickets enrichment
   - CRM finances endpoints
   - helper services (plan-fact, guide, permissions)
3. Find all frontend places that depend on dictionary/directories data:
   - CRM kanban store
   - directories/guide
   - plan-fact grid
4. Collect the exact fields the UI relies on:
   - `name`, `_id`, `projects_ids`, `is_active`, `track_id`, etc.

### Stage B. Define the new model and mapping

5. Confirm the hierarchy:
   - Customer (formerly "client")
   - Project Group (formerly "track")
   - Project
6. Align fields for each entity:
   - Customer: `_id`, `name`, `is_active`, `project_groups_ids`
   - Project Group: `_id`, `name`, `is_active`, `projects_ids`
   - Project: `_id`, `name`, `is_active` (optional: `project_group_id` for faster queries)
7. Map old fields to the new model:
   - old client -> new customer
   - old track -> new project group
   - legacy `clients.projects_ids` -> `customers.project_groups_ids -> project_groups.projects_ids`

### Stage C. Backend: CRM dictionary and related endpoints

8. CRM dictionary:
   - switch from `COLLECTIONS.CLIENTS` to `COLLECTIONS.CUSTOMERS`
   - switch from `COLLECTIONS.TRACKS` to `COLLECTIONS.PROJECT_GROUPS`
   - rebuild `track -> client -> project` into `project_group -> customer -> project`
   - keep `show_inactive` support
9. Response compatibility:
   - if the frontend expects legacy naming (`track`/`client`), keep aliases or normalize in the frontend.
10. CRM tickets enrichment:
   - derive customer + group by following `customers -> project_groups -> projects` for a given `project_id`.
11. CRM finances:
   - update `/api/crm/finances/client` (and similar) to read from `automation_customers`.

### Stage D. Backend: shared services/helpers

12. Add helper functions:
   - `getCustomers()`, `getProjectGroups()`, `getProjects()`
   - `buildProjectToCustomerMap()`
   - `buildCustomerTree()`
13. Ensure `backend/src/constants.ts` reflects current collection names.
14. If needed, add a migration feature flag (for example `USE_CUSTOMERS=true`) to safely roll out.

### Stage E. Frontend: update contracts/stores

15. CRM kanban store:
   - migrate to new fields (`customers`/`project_groups`) or normalize legacy response into the new shape.
16. Directories (Guide):
   - confirm which directories are used (`clients`, `tracks`) and decide whether to keep legacy naming or introduce new naming.
17. Plan-Fact:
   - ensure clients/customers used in `GET /plan-fact` come from `automation_customers` and names/ids are consistent.

### Stage F. Tests and verification

18. Smoke-test API:
   - `POST /api/crm/dictionary`
   - `POST /api/crm/tickets` (customer + group metadata)
   - `GET /api/plan-fact` (customer list/names)
19. UI checks:
   - CRMPage: dictionary load, filters, tree navigation
   - Directories: clients/projects/rates tables
   - Plan-Fact: correct customer names and grouping

### Stage G. Long-term cleanup

20. Record that `automation_clients` is no longer used by code.
21. Add documentation note about the legacy collection.
22. (Optional) prepare a migration/removal script after final verification.

## 4) Queries used for analysis (log)

1. Collections and sample docs:
   - `db.getCollectionNames()`
   - `db.automation_customers.findOne({}, {name:1,is_active:1,project_groups_ids:1})`
   - `db.automation_project_groups.findOne({}, {name:1,is_active:1,projects_ids:1})`
   - `db.automation_projects.findOne({}, {name:1,is_active:1})`
2. Relationship field checks:
   - `db.automation_project_groups.countDocuments({ customer_id: { $exists: true } })`
   - `db.automation_project_groups.countDocuments({ customers_ids: { $exists: true } })`
   - `db.automation_projects.countDocuments({ customer_id: { $exists: true } })`
   - `db.automation_projects.countDocuments({ project_group_id: { $exists: true } })`
   - `db.automation_projects.countDocuments({ project_group_ids: { $exists: true } })`
