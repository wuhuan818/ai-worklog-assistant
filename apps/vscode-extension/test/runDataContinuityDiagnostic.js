// Diagnostic-only entry point. The canonical runner has identical test behavior;
// it retains a failed run below artifacts/e2e-diagnostics and cleans successful runs.
process.env.STAGE6_E2E_DIAGNOSTIC = '1';
require('./runDataContinuityE2E');
