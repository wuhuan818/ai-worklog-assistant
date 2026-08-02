const fs = require('node:fs');
const path = require('node:path');
const marker = process.env.E2E_MARKERS;
function mark(name, extra = {}) { if (marker) fs.appendFileSync(marker, JSON.stringify({ name, at: new Date().toISOString(), ...extra }) + '\n', 'utf8'); }
exports.run = async () => { mark('test_entry_loaded'); mark('test_run_invoked'); mark('suite_registered', { testCount: 1 }); mark('first_test_started'); mark('suite_completed', { passed: true }); };
