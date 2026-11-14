#!/usr/bin/env node
// thesis/tools/hygiene.mjs — what the field's own published accounts hold.
//
//   node thesis/tools/hygiene.mjs
//
// Method: take the testnet account ids named in the READMEs of the eleven
// comparable agent-vault repositories, ask the chain for their access keys, and
// classify. Read-only: no signing, no writes to the chain, one JSON file out.
//
// Why it belongs in this repository: submission #2 measures whether policies
// refuse. This measures the layer underneath — whether the agent can bypass the
// contract entirely by holding a key that the policy cannot see. A vault whose
// agent keeps a FullAccess key enforces nothing against that agent.
//
// Limits, stated here so the write-up cannot overstate them: the sample is the
// eleven repositories audited on 2026-11-13, the "agent" label is inferred from
// the account id, and testnet deploy keys are commonly left in place because the
// account is disposable. This is an observation about published demos.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'data', 'hygiene.json');

const REPOS = [
  '0xNexuz/agentshield',
  'Cubiczan/near-aegis-vault',
  'Bronxydrone/Veto',
  'talibot-agent/leash',
  'mesh-pch/leash-near',
  'BeautyBenedict/leash',
  'aselolee99/agent-vault',
  'ritesh59697/allowance-ai',
  'thesithunyein/kyrona',
  'hahahahahahahahah6/near-agent-guard',
  '0xileri/SpactVault',
];

// Shared testnet infrastructure that repos name in their instructions. Counting
// these as project accounts inflates every number; the exclusion is printed.
const SHARED = new Set([
  'rpc.testnet',
  'archival-rpc.testnet',
  'helper.testnet',
  'wrap.testnet',
  'explorer.testnet',
  'token.testnet',
  'alice.testnet',
  'mallory.testnet',
  'evil.testnet',
  'attacker.testnet',
  'api-provider.testnet',
]);

const SELF = 'mandate-hackaton-7c1a.testnet';
const ENDPOINTS = ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'];
const NEAR = 1e24;

const fail = (code, detail) => {
  console.error(`hygiene: ${code}: ${detail}`);
  process.exit(3);
};

const rpc = async (method, params) => {
  let last = 'no endpoint tried';
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'hygiene', method, params }),
        signal: AbortSignal.timeout(25_000),
      });
      const body = await res.json();
      if (body?.result || body?.error) return body;
      last = 'empty response';
    } catch (err) {
      last = err.message;
    }
  }
  fail('rpc_unreachable', last);
};

const status = await rpc('status', {});
if (status?.result?.chain_id && status.result.chain_id !== 'testnet') {
  fail('wrong_network', `the endpoint reports ${status.result.chain_id}, not testnet`);
}

const readme = async (repo) => {
  for (const branch of ['main', 'master']) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/README.md`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return res.text();
    } catch {
      /* next */
    }
  }
  return '';
};

const accounts = new Map();
for (const repo of REPOS) {
  const text = await readme(repo);
  const found = new Set(text.match(/[a-z0-9][a-z0-9._-]*\.testnet\b/g) ?? []);
  for (const account of found) {
    if (!accounts.has(account)) accounts.set(account, new Set());
    accounts.get(account).add(repo);
  }
  console.log(`  ${repo.padEnd(34)} ${found.size} testnet accounts named`);
}

const classify = async (account) => {
  const body = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: account });
  const keys = body?.result?.keys;
  if (!keys) return { account, exists: false };
  let full = 0;
  let functionCall = 0;
  let anyMethod = 0;
  let maxAllowance = 0n;
  for (const k of keys) {
    const perm = k.access_key.permission;
    if (perm === 'FullAccess') {
      full += 1;
    } else {
      functionCall += 1;
      const fc = perm.FunctionCall;
      if ((fc.methodNames?.length ?? 0) === 0) anyMethod += 1;
      const allowance = BigInt(fc.allowance ?? '0');
      if (allowance > maxAllowance) maxAllowance = allowance;
    }
  }
  return {
    account,
    exists: true,
    keys: keys.length,
    fullAccess: full,
    functionCall,
    unrestrictedMethodNames: anyMethod,
    maxAllowanceNear: Number(maxAllowance) / NEAR,
  };
};

const rows = [];
for (const account of accounts.keys()) rows.push(await classify(account));
const selfRow = await classify(SELF);

const live = rows.filter((r) => r.exists && !SHARED.has(r.account));
const agents = live.filter((r) => /agent/i.test(r.account.split('.')[0]));

const summary = {
  repos: REPOS.length,
  named: rows.length,
  live: rows.filter((r) => r.exists).length,
  sharedExcluded: rows.filter((r) => r.exists && SHARED.has(r.account)).length,
  project: live.length,
  projectWithFullAccess: live.filter((r) => r.fullAccess > 0).length,
  projectWithUnrestrictedMethodNames: live.filter((r) => r.unrestrictedMethodNames > 0).length,
  agentNamed: agents.length,
  agentNamedWithFullAccess: agents.filter((r) => r.fullAccess > 0).length,
};

const doc = {
  schema: 1,
  source: 'view_access_key_list over public testnet RPC, accounts named in 11 audited READMEs',
  collectedAt: new Date().toISOString(),
  blockHeight: Number(status?.result?.sync_info?.latest_block_height ?? 0),
  method: 'README → *.testnet account ids → access keys; shared infrastructure excluded by name',
  sharedExcluded: [...SHARED],
  summary,
  self: { account: SELF, ...selfRow, note: 'the contract account of submission #1: it holds a deploy key, which is why C25 is about the agent key and not this one' },
  rows: live,
};

writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);

console.log(`\n  ${summary.project} project accounts (${summary.sharedExcluded} shared excluded)`);
console.log(`  full access key still present: ${summary.projectWithFullAccess}`);
console.log(`  function-call key with no method restriction: ${summary.projectWithUnrestrictedMethodNames}`);
console.log(`  agent-named accounts: ${summary.agentNamed}, with full access: ${summary.agentNamedWithFullAccess}`);
console.log(`  self (${SELF}): full=${selfRow.fullAccess} functionCall=${selfRow.functionCall}`);
console.log(`  ${out}`);
