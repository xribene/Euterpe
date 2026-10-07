// Smoke check of a running Euterpe page (the same check as `euterpe smoke`, packages/euterpe/cli/smoke.js).
//   node tools/smoke/check.mjs <url> [--expect-answer] [--set=slider:3:0 ...] [--wait=ms] [--logs] [--screenshot=f.png]
// Prints the JSON report; exits 1 if a check fails.
import {smoke} from '../../packages/euterpe/cli/smoke.js';

const url = process.argv[2] ?? 'http://localhost:5173/';
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const report = await smoke(url, {
    expectAnswer: process.argv.includes('--expect-answer'),
    wait: arg('wait') ? Number(arg('wait')) : undefined,
    screenshot: arg('screenshot') ?? null,
    set: process.argv.filter((a) => a.startsWith('--set=')).map((a) => a.slice(6).split(':'))
        .map(([kind, id, value]) => [kind, Number(id), Number(value)]),
});
const logs = report.logs;
delete report.logs;
console.log(JSON.stringify(report, null, 1));
if (process.argv.includes('--logs')) console.log(logs.join('\n'));
process.exit(report.ok ? 0 : 1);
