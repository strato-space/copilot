import { describe, it, expect } from '@jest/globals';
import {
    buildRuntimeFilter,
    isRuntimeScopedCollection,
    mergeWithRuntimeFilter,
    recordMatchesRuntime,
    resolveBetaTag,
} from '../../src/services/runtimeScope.js';

describe('runtimeScope helpers', () => {
    it('resolveBetaTag normalizes VOICE_BOT_IS_BETA values', () => {
        expect(resolveBetaTag(undefined)).toBe('');
        expect(resolveBetaTag('')).toBe('');
        expect(resolveBetaTag('false')).toBe('');
        expect(resolveBetaTag('true')).toBe('beta');
        expect(resolveBetaTag('gamma')).toBe('gamma');
    });

    it('buildRuntimeFilter includes legacy records for prod runtime', () => {
        const filter = buildRuntimeFilter({
            field: 'runtime_tag',
            runtimeTag: 'prod',
            prodRuntime: true,
            includeLegacyInProd: true,
        });

        expect(filter).toEqual({
            $or: [
                { runtime_tag: 'prod' },
                { runtime_tag: { $exists: false } },
                { runtime_tag: null },
                { runtime_tag: '' },
            ],
        });
    });

    it('buildRuntimeFilter is strict for non-prod runtime', () => {
        const filter = buildRuntimeFilter({
            field: 'runtime_tag',
            runtimeTag: 'gamma',
            prodRuntime: false,
        });
        expect(filter).toEqual({ runtime_tag: 'gamma' });
    });

    it('mergeWithRuntimeFilter combines query and runtime scope', () => {
        const merged = mergeWithRuntimeFilter(
            { is_deleted: { $ne: true } },
            {
                field: 'runtime_tag',
                runtimeTag: 'gamma',
                prodRuntime: false,
            }
        );

        expect(merged).toEqual({
            $and: [
                { is_deleted: { $ne: true } },
                { runtime_tag: 'gamma' },
            ],
        });
    });

    it('recordMatchesRuntime supports prod legacy and strict non-prod checks', () => {
        expect(recordMatchesRuntime({ runtime_tag: 'prod' }, {
            runtimeTag: 'prod',
            prodRuntime: true,
            includeLegacyInProd: true,
        })).toBe(true);

        expect(recordMatchesRuntime({}, {
            runtimeTag: 'prod',
            prodRuntime: true,
            includeLegacyInProd: true,
        })).toBe(true);

        expect(recordMatchesRuntime({ runtime_tag: 'prod' }, {
            runtimeTag: 'gamma',
            prodRuntime: false,
        })).toBe(false);

        expect(recordMatchesRuntime({ runtime_tag: 'gamma' }, {
            runtimeTag: 'gamma',
            prodRuntime: false,
        })).toBe(true);
    });

    it('marks runtime-scoped collections from migration contract', () => {
        const runtimeScoped = [
            'automation_voice_bot_sessions',
            'automation_voice_bot_messages',
            'automation_voice_bot_topics',
            'automation_tg_voice_sessions',
            'automation_one_use_tokens',
            'automation_prompts_status',
            'automation_agents_status',
            'automation_agents_run_results',
            'automation_permissions_log',
            'automation_voice_bot_session_log',
            'automation_object_locator',
            'automation_object_types',
            'automation_tasks',
            'automation_tasks_histrory',
            'automation_comments',
            'automation_updates',
            'automation_work_hours',
            'automation_calendar_month_work_hours',
            'automation_execution_plans_items',
            'automation_epic_tasks',
            'automation_bot_commands',
            'automation_performer_payments',
            'finops_finances_expenses',
            'finops_finances_income',
            'finops_finances_income_types',
            'facts_project_month',
            'forecasts_project_month',
            'fx_monthly',
            'fund_comments',
            'finops_expense_categories',
            'finops_expense_operations',
            'finops_expense_operations_log',
            'finops_fx_rates',
            'finops_month_closures',
            'automation_reports_log',
            'automation_sync_files',
            'automation_google_drive_events_channels',
            'automation_google_drive_structure',
            'automation_design_data',
            'automation_figma_files_cache',
        ];

        for (const name of runtimeScoped) {
            expect(isRuntimeScopedCollection(name)).toBe(true);
        }
    });

    it('keeps shared reference collections outside runtime scope', () => {
        const sharedCollections = [
            'automation_performers',
            'automation_performers_roles',
            'automation_projects',
            'automation_project_groups',
            'automation_customers',
            'automation_task_types',
            'automation_task_supertypes',
            'automation_task_types_tree',
            'automation_boards',
            'automation_tracks',
            'automation_names_dictionary',
        ];

        for (const name of sharedCollections) {
            expect(isRuntimeScopedCollection(name)).toBe(false);
        }
    });
});
