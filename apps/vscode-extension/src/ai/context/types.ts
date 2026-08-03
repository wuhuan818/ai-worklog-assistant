import { AiContextBuildConfig, AiContextPackage } from '../../apiClient';

export const CONTEXT_SCHEMA_VERSION = 'task-context-package/v1' as const;
export const BUILD_CONFIG_SCHEMA_VERSION = 'context-build-config/v1' as const;
export type ContextBuildConfig = AiContextBuildConfig;
export type ContextPackage = AiContextPackage;

export function defaultBuildConfig(budget = 32000): ContextBuildConfig {
  return { schema_version: BUILD_CONFIG_SCHEMA_VERSION, estimated_input_token_budget: budget, include_manual_notes: true, include_bug_details: true, include_file_changes: true, include_diff_snippets: true, include_diagnostics: true, include_commands_and_tasks: true, include_debug_events: true, include_event_summary: true };
}
export function validBudget(value: number): number { return Number.isInteger(value) && value >= 4000 && value <= 128000 ? value : 32000; }
