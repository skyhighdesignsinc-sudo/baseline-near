#!/usr/bin/env node
// thesis/tools/e2e.mjs — end-to-end check of the *artefacts* the repository ships.
//
// The unit the experiment tests is the contract; the unit this tests is the
// repository: the dataset, the two JSON files written by the tools, and the
// sentences in the docs that quote numbers from them.
//
// It runs offline by default, so it works in a fresh clone with no RPC. With
// `--online` it also asks a public testnet node whether every transaction in the
// dataset exists and was executed, which is the part a reader cannot check by
// reading the file.
//
// Exit codes: 0 clean, 1 the artefacts disagree, 3 the online check could not run.
//
// Why this exists: the claim is "every figure is re-derivable and every hash is
// public". A claim like that is worth exactly as much as the command that fails
// when it stops being true.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const read = (p) => readFileSync(resolve(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const problems = [];
const record = (name, fn) => {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    problems.push(`${name}: ${err.message}`);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const equal = (actual, expected, what) => {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const KNOWN_CODES = new Set([
  'authorised',
  'per_tx_exceeded',
  'per_day_exceeded',
  'per_counterparty_day_exceeded',
  'counterparty_not_allowed',
  'amount_zero',
  'asset_mismatch',
  'chain_not_enabled',
  'mandate_suspended',
  'mandate_expired',
  'budget_exhausted',
  'attestation_mismatch',
  'attestation_required',
  'decision_replayed',
  'policy_changed',
  'policy_invalid',
  'not_found',
]);

console.log('\n  artefacts');

const spends = json('data/spends.json');
const state = json('data/state.json');
const findings = read('docs/FINDINGS.md');
const readme = read('README.md');

record('spends.json is a run, not a sample', () => {
  equal(spends.schema, 1, 'schema');
  assert(Array.isArray(spends.rows) && spends.rows.length > 0, 'no rows');
  assert(Number(spends.blockHeight) > 0, 'no block height');
  assert(/^[0-9a-f]{12}$/.test(spends.run), `run id is not 12 hex chars: ${spends.run}`);
  assert(spends.source, 'no source line: a reader cannot tell where the rows came from');
});

record('every row carries evidence a reader can open', () => {
  for (const row of spends.rows) {
    const where = `${row.shape}/${row.case}`;
    assert(BASE58.test(row.tx), `${where}: tx is not a base58 hash (${row.tx})`);
    assert(row.explorer?.endsWith(row.tx), `${where}: explorer link does not end in the tx hash`);
    assert(row.explorer.startsWith('https://'), `${where}: explorer link is not absolute`);
    if (row.kind === 'create') {
      // A create-path refusal has no mandate to point at. The evidence is the policy
      // the contract declined to store, which must actually violate a rule.
      const p = row.rejected_policy;
      assert(p && typeof p === 'object', `${where}: no rejected policy on a create row`);
      assert(
        BigInt(p.escalate_over) > BigInt(p.per_tx),
        `${where}: the policy in the row would have passed validate(), so nothing was refused`,
      );
    } else {
      assert(row.mandate?.startsWith('m'), `${where}: no mandate id`);
    }
    assert(typeof row.matched === 'boolean', `${where}: matched is not a boolean`);
  }
});

record('no transaction is counted twice', () => {
  const seen = new Set();
  for (const row of spends.rows) {
    assert(!seen.has(row.tx), `duplicate tx ${row.tx}`);
    seen.add(row.tx);
  }
});

record('the recorded outcome is what the run expected', () => {
  for (const row of spends.rows) {
    equal(row.got, row.expected, `${row.shape}/${row.case} outcome`);
    assert(row.matched === true, `${row.shape}/${row.case} is flagged as a mismatch`);
    assert(KNOWN_CODES.has(row.got), `${row.shape}/${row.case}: unknown code ${row.got}`);
  }
});

record('the counts are recomputed from the rows', () => {
  const rows = spends.rows;
  const authorised = rows.filter((r) => r.got === 'authorised').length;
  equal(spends.counts.attempts, rows.length, 'attempts');
  equal(spends.counts.authorised, authorised, 'authorised');
  equal(spends.counts.refused, rows.length - authorised, 'refused');
  equal(spends.counts.mismatches, rows.filter((r) => r.matched !== true).length, 'mismatches');
});

record('state.json agrees with itself', () => {
  equal(state.schema, 1, 'schema');
  equal(state.counts.mandates, state.mandates.length, 'mandate count');
  assert(Number(state.blockHeight) > 0, 'no block height');
  assert(/^\d+$/.test(String(state.stats.total_authorised)), 'total_authorised is not an integer string');
  equal(state.account, spends.account, 'the two files describe different contracts');
});

record('the prose quotes the dataset, not a memory of it', () => {
  const m = findings.match(/(\d+) attempts, (\d+) authorised, (\d+) refused/);
  assert(m, 'FINDINGS.md no longer states the attempt counts in the documented form');
  equal(Number(m[1]), spends.counts.attempts, 'FINDINGS attempts');
  equal(Number(m[2]), spends.counts.authorised, 'FINDINGS authorised');
  equal(Number(m[3]), spends.counts.refused, 'FINDINGS refused');

  const r = readme.match(/(\d+) attempts, block (\d+)/);
  assert(r, 'README.md no longer states the run in the documented form');
  equal(Number(r[1]), spends.counts.attempts, 'README attempts');
  equal(Number(r[2]), spends.blockHeight, 'README block height');
});

record('every transaction cited in the docs is accounted for by kind', () => {
  const inDataSet = new Set(spends.rows.map((r) => r.tx));

  // Two hashes are cited in FINDINGS.md and are not spends in the current dataset,
  // for two different reasons. Both are chain-verifiable; naming them here is what
  // makes the difference explicit instead of a silent exception.
  //
  // DEPLOY: the contract deploy that shipped the fix. It is evidence for F-1 but it
  // is not a spend, so it can never appear as a row.
  const DEPLOY = new Set(['77th4RrA1DQQzxLVXQ6Ag2K6EnhHyqcBP3v47gXTLBVk']);
  // HISTORIC: hashes from earlier runs that F-1 cites. The dataset holds one run by
  // design, so every re-run replaces the file and these stop being rows — but they stay
  // on chain and remain the evidence for the finding that produced them. Two are the
  // pre-fix spends that should have been refused; two are the same case after the fix.
  const HISTORIC = new Set([
    'bYgsuPRCYi4ZNGgV6tskBaU8cfcQerVGea1WVAXdQw7',
    'G1JZHxASLm14U9UaLuHcLVsUymW59HwpthuHTLg6xM2d',
    'AkNHWAaVyobe7TLiuu8FAqSbP6GKSjZm9aDQoCLZwZQn',
    'E8cYASoLZanuZGtaA6e766wnGNzdhV1QFsYCvjyCcny3',
  ]);

  const cited = new Set(findings.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/g) ?? []);
  assert(cited.size >= 4, 'FINDINGS.md cites fewer hashes than expected');
  for (const hash of cited) {
    const kind = inDataSet.has(hash) ? 'spend' : DEPLOY.has(hash) ? 'deploy' : HISTORIC.has(hash) ? 'historic' : null;
    assert(kind !== null, `FINDINGS.md cites ${hash}, which is in none of: dataset, deploy, historic`);
  }
  // The three kinds must all be present, or the finding has lost its evidence.
  assert([...cited].some((h) => inDataSet.has(h)), 'FINDINGS.md cites no spend from the current run');
  assert([...cited].some((h) => DEPLOY.has(h)), 'FINDINGS.md no longer cites the fix deploy');
  assert([...cited].some((h) => HISTORIC.has(h)), 'FINDINGS.md no longer cites the pre-fix spend');
});

if (process.argv.includes('--online')) {
  console.log('\n  chain');
  const ENDPOINTS = ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'];

  const post = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return res.json();
  };

  const statusOf = async (hash) => {
    let last;
    for (const url of ENDPOINTS) {
      try {
        const out = await post(url, {
          jsonrpc: '2.0',
          id: 'thesis-e2e',
          method: 'tx',
          params: { tx_hash: hash, sender_account_id: spends.account, wait_until: 'NONE' },
        });
        if (out?.result) return out.result;
        last = out?.error?.message ?? 'no result';
      } catch (err) {
        last = err.message;
      }
    }
    throw new Error(`rpc unavailable for ${hash}: ${last}`);
  };

  let reachable = 0;
  for (const row of spends.rows) {
    try {
      const result = await statusOf(row.tx);
      const executed = result?.receipts_outcome?.length > 0 || result?.status !== undefined;
      if (!executed) problems.push(`chain: ${row.tx} has no execution outcome`);
      else reachable += 1;
      console.log(`  ${executed ? 'ok  ' : 'FAIL'}  ${row.shape}/${row.case}  ${row.tx}`);
    } catch (err) {
      console.log(`  FAIL  ${row.shape}/${row.case}  ${err.message}`);
      problems.push(`chain: ${err.message}`);
    }
  }

  if (reachable === 0) {
    console.log('\n  e2e: online_unavailable — no testnet endpoint answered; re-run later');
    process.exitCode = 3;
  }
}

console.log('');
if (problems.length > 0) {
  for (const p of problems) console.log(`  e2e: ${p}`);
  console.log(`\n  ${problems.length} problem(s). The artefacts disagree with each other.\n`);
  process.exitCode = 1;
} else if (process.exitCode !== 3) {
  console.log(`  ${spends.counts.attempts} rows, ${spends.counts.refused} refusals, one run — artefacts agree.\n`);
}
