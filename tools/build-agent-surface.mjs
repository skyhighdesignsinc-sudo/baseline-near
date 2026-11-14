// tools/build-agent-surface.mjs — the machine surface for the judge view.
//
// The page is static, so "agent enabled" cannot mean a server. It means two
// files an agent can fetch and parse without a browser: a plain-text map
// (llms.txt) and a summary computed from the same dataset the page renders.
// Nothing here computes an outcome — every number is counted from data/spends.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const dir = new URL('../site/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/spends.json', dir), 'utf8'));

const rows = data.rows ?? [];
const refused = rows.filter((r) => r.got !== 'authorised');
const codes = [...new Set(rows.map((r) => r.got))].sort();

const summary = {
  schema: 'baseline.site.summary/1',
  subject: {
    what: 'A re-runnable matrix of 24 policy attempts against one deployed NEAR testnet contract.',
    account: data.account,
    run: data.run,
    blockHeight: data.blockHeight,
    explorer: data.explorer,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
  },
  counts: {
    attempts: rows.length,
    authorised: rows.length - refused.length,
    refused: refused.length,
    distinctCodes: codes.length,
    rowsWithTransaction: rows.filter((r) => r.tx).length,
  },
  codes,
  datasets: {
    rows: './data/spends.json',
    thisSummary: './api/summary.json',
  },
  verification: {
    hashResolver: 'node tools/check-evidence.mjs data/spends.json (from the repository root)',
    artefactAgreement: 'node tools/e2e.mjs',
    explorerTemplate: 'https://testnet.nearblocks.io/txns/{hash}',
  },
  notClaimed: [
    'no mainnet deployment',
    'no audit',
    'the 24 attempts are one run, not a distribution',
    'the matrix measures the sibling submission’s contract',
  ],
};

const map = `# Baseline — machine-readable map

This is a static page. There is no API server: the three files below are the whole
surface, and all of them are fetched with a plain GET.

## Files

- /data/spends.json — the run. One object per attempt: {id, shape, case, expected,
  got, matched, amount, vendor, mandate, tx, explorer}. "got" is the code the
  contract returned; "expected" is what the run predicted. amount is in base units
  (6 decimals: 20000000 = 20 USDC).
- /api/summary.json — counts derived from that file, plus the run id and block height.
- / — the human view, which renders the same JSON and computes nothing.

## Identifiers

- contract account: ${data.account}
- run: ${data.run} at block ${data.blockHeight}
- ${rows.length} attempts, ${rows.length - refused.length} authorised, ${refused.length} refused,
  ${codes.length} distinct outcome codes
- every row with a "tx" resolves at https://testnet.nearblocks.io/txns/<tx>

## How to check this without trusting it

1. Fetch /data/spends.json; recompute the counts yourself.
2. For any row, GET https://rpc.testnet.near.org with a tx status call for its hash.
   A refusal is a failed transaction whose receipt log contains "violation: <code>".
3. In the repository, \`node tools/check-evidence.mjs data/spends.json\` exits non-zero
   when a single hash stops resolving, and \`node tools/e2e.mjs\` exits non-zero when
   the prose and the dataset disagree.

## What this does not claim

${summary.notClaimed.map((line) => `- ${line}`).join('\n')}

## Citing it

Baseline (NEAR Hackathon 2026, testnet). If you quote a figure, quote the run id with
it: ${data.run}.
`;

mkdirSync(new URL('api/', dir), { recursive: true });
writeFileSync(new URL('api/summary.json', dir), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(new URL('llms.txt', dir), map);
console.log(`site/api/summary.json  ${rows.length} rows, ${codes.length} codes`);
console.log('site/llms.txt');
