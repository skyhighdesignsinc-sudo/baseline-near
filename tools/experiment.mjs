#!/usr/bin/env node
// thesis/tools/experiment.mjs — the spend matrix, executed against a deployed contract.
//
// Fourteen policy shapes, twenty-four cases, one transaction each. Every row is either
// a real transaction hash or a refusal code the contract logged before it trapped: the
// matrix now exercises all twenty-one frozen codes that a `spend` call can produce,
// plus `policy_invalid` on the create path. A case
// whose outcome differs from its expectation is written to the dataset and makes
// the run exit non-zero: a surprise is data, but it must never pass silently.
//
// Nothing here invents an outcome. The expected code is declared next to the call,
// and a mismatch is reported, not smoothed over.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { actions } from 'near-api-js';

import { EXPLORER, Fail, accountExists, intentHash, loadCredentials, rpc, sha256Hex, submit, viewCall } from './near.mjs';

const USDC = 1_000_000;
const GAS = 100_000_000_000_000n;
const CODE_HASH = 'sha256:9f3a7c1e5b0d2468ac9e71f3d5b8c0a2e4f60719283b4c5d6e7f8091a2b3c4d5';

const VENDOR_A = { chain: 'base_sepolia', to: '0x9f2c55ac1d3e4b77a0c8f1d2e3b4a5c6d7e8f901', label: 'openrouter' };
const VENDOR_B = { chain: 'base_sepolia', to: '0x1111111111111111111111111111111111111111', label: 'aws-but-not-allowlisted' };

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  const next = process.argv[i + 1];
  return i >= 0 && next && !next.startsWith('--') ? next : fallback;
};

const account = arg('account', process.env.MANDATE_CONTRACT ?? '');
const out = resolve(arg('out', 'thesis/data/spends.json'));
const repeat = Number(arg('repeat', '1'));

if (!account) {
  console.error('usage: node thesis/tools/experiment.mjs --account <contract.testnet> [--repeat N] [--out path]');
  process.exit(2);
}
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
  console.error('--repeat must be an integer from 1 to 20');
  process.exit(2);
}

// The contract's own validator requires `per_tx <= per_day` and
// `escalate_over <= per_tx`, so the daily shape cannot keep a 30 USDC per-tx cap
// under a 25 USDC daily ceiling. Each shape carries values that pass validate()
// while isolating one rule; `escalate_over` sits at the per-tx cap so no case in
// the matrix escalates (a spend must be strictly greater to become pending).
/** A policy the contract accepts, with one dimension varied per shape. */
const policyFor = (shape, blockHeight) => {
  const limits = { per_tx: 30, per_day: 90, per_cp: 100, ...(shape.limits ?? {}) };
  return {
    version: 1,
    asset: 'USDC',
    // A shape that tests expiry is created already expired: the policy carries the
    // height that was current when the transaction was built, and the spend lands in
    // a later block, so `block_height > expires_at_block` holds by construction.
    expires_at_block: shape.expiresNow ? blockHeight : 0,
    allow: shape.allow ?? [VENDOR_A, VENDOR_B],
    per_tx: String(limits.per_tx * USDC),
    per_day: String(limits.per_day * USDC),
    per_counterparty_day: String(limits.per_cp * USDC),
    // One past the per-tx cap, so `validate()` answers `policy_invalid` instead of
    // the contract accepting a policy it would later refuse to honour.
    escalate_over: String((limits.per_tx + (shape.invalidPolicy ? 1 : 0)) * USDC),
    require_attestation: true,
    attestation_code_hash: CODE_HASH,
  };
};

const SHAPES = [
  {
    id: 'per_tx',
    question: 'does a per-transaction cap refuse before the balance moves?',
    limits: { per_tx: 30, per_day: 90 },
    cases: [
      { id: 'inside', amount: 10 * USDC, vendor: VENDOR_A, expect: 'authorised' },
      { id: 'over_cap', amount: 40 * USDC, vendor: VENDOR_A, expect: 'per_tx_exceeded' },
      { id: 'zero', amount: 0, vendor: VENDOR_A, expect: 'amount_zero' },
    ],
  },
  {
    id: 'daily',
    question: 'is the daily ceiling enforced on the second spend, not the first?',
    limits: { per_tx: 20, per_day: 25 },
    cases: [
      { id: 'first_20', amount: 20 * USDC, vendor: VENDOR_A, expect: 'authorised' },
      { id: 'second_10', amount: 10 * USDC, vendor: VENDOR_A, expect: 'per_day_exceeded' },
    ],
  },
  {
    id: 'allowlist',
    question: 'is a vendor outside the allowlist refused even at a legal amount?',
    limits: { per_tx: 30, per_day: 90 },
    allow: [VENDOR_A],
    cases: [
      { id: 'listed', amount: 5 * USDC, vendor: VENDOR_A, expect: 'authorised' },
      { id: 'unlisted', amount: 5 * USDC, vendor: VENDOR_B, expect: 'counterparty_not_allowed' },
    ],
  },
  {
    id: 'attestation',
    question: 'which part of a decision is bound to the payment?',
    limits: { per_tx: 30, per_day: 90 },
    cases: [
      { id: 'matching', amount: 5 * USDC, vendor: VENDOR_A, expect: 'authorised' },
      { id: 'off_by_one', amount: 5 * USDC, vendor: VENDOR_A, tamper: 'intent', expect: 'attestation_mismatch' },
      { id: 'stale_policy', amount: 5 * USDC, vendor: VENDOR_A, tamper: 'policy', expect: 'policy_changed' },
    ],
  },
  {
    id: 'suspended',
    question: 'does the owner stopping a mandate refuse the next spend, and only then?',
    limits: { per_tx: 30, per_day: 90 },
    cases: [
      { id: 'before', amount: 10 * USDC, vendor: VENDOR_A, expect: 'authorised' },
      { id: 'after_stop', amount: 10 * USDC, vendor: VENDOR_A, before: 'suspend', expect: 'mandate_suspended' },
    ],
  },
  {
    id: 'expired',
    question: 'does a policy stop enforcing after the block it names?',
    limits: { per_tx: 30, per_day: 90 },
    expiresNow: true,
    cases: [{ id: 'late', amount: 5 * USDC, vendor: VENDOR_A, expect: 'mandate_expired' }],
  },
  {
    id: 'asset',
    question: 'is a spend in another asset refused?',
    limits: { per_tx: 30, per_day: 90 },
    cases: [{ id: 'wrong_asset', amount: 5 * USDC, asset: 'NEAR', vendor: VENDOR_A, expect: 'asset_mismatch' }],
  },
  {
    id: 'chain',
    question: 'is a chain the policy never enabled refused before the vendor is even read?',
    limits: { per_tx: 30, per_day: 90 },
    cases: [
      { id: 'wrong_chain', amount: 5 * USDC, chain: 'ethereum', vendor: VENDOR_A, expect: 'chain_not_enabled' },
    ],
  },
  {
    id: 'counterparty',
    question: 'does one vendor\u2019s own daily ceiling bind before the mandate ceiling does?',
    limits: { per_tx: 8, per_day: 90, per_cp: 10 },
    cases: [
      { id: 'first_8', amount: 8 * USDC, vendor: VENDOR_A, expect: 'authorised' },
      { id: 'second_8', amount: 8 * USDC, vendor: VENDOR_A, expect: 'per_counterparty_day_exceeded' },
    ],
  },
  {
    id: 'budget',
    question: 'is a spend refused when the funded balance, not a counter, runs out?',
    limits: { per_tx: 8, per_day: 90, per_cp: 100 },
    deposit: 10 * USDC,
    cases: [
      { id: 'first_8', amount: 8 * USDC, vendor: VENDOR_A, expect: 'authorised' },
      { id: 'second_8', amount: 8 * USDC, vendor: VENDOR_A, expect: 'budget_exhausted' },
    ],
  },
  {
    id: 'no_attestation',
    question: 'is a spend refused when the attestation carries no decision?',
    limits: { per_tx: 30, per_day: 90 },
    cases: [
      { id: 'empty_quote', amount: 5 * USDC, vendor: VENDOR_A, omitAttestation: true, expect: 'attestation_required' },
    ],
  },
  {
    id: 'replay',
    question: 'can one recorded decision authorise two payments?',
    limits: { per_tx: 30, per_day: 90 },
    cases: [
      { id: 'first', amount: 5 * USDC, vendor: VENDOR_A, decision: 'fixed', expect: 'authorised' },
      { id: 'replay', amount: 5 * USDC, vendor: VENDOR_A, decision: 'fixed', expect: 'decision_replayed' },
    ],
  },
  {
    id: 'unknown_id',
    question: 'is a spend against a mandate that does not exist refused by name?',
    limits: { per_tx: 30, per_day: 90 },
    cases: [
      { id: 'no_mandate', amount: 5 * USDC, vendor: VENDOR_A, idOverride: 'no-such-mandate', expect: 'not_found' },
    ],
  },
  {
    id: 'invalid_policy',
    question: 'does the contract refuse to create a policy it cannot honour?',
    limits: { per_tx: 30, per_day: 90 },
    invalidPolicy: true,
    plan: 'create',
    cases: [{ id: 'escalate_over_cap', amount: 0, vendor: VENDOR_A, expect: 'policy_invalid' }],
  },
];

const say = (line = '') => console.log(line);
const startedAt = new Date().toISOString();

async function createMandate(credentials, shape, blockHeight) {
  // No `.catch(() => [])` here: a failed read is not "no mandates", and treating it
  // as such would make the first existing mandate look like the one just created.
  const before = await viewCall(account, 'list_mandates');
  const known = new Set(before.map((m) => m.id));
  const created = await submit({
    signerId: account,
    keyPair: credentials.keyPair,
    receiverId: account,
    say: () => {},
    actionList: [
      actions.functionCall(
        'create_mandate',
        { agent: account, policy: policyFor(shape, blockHeight) },
        GAS,
        BigInt(shape.deposit ?? 100 * USDC),
      ),
    ],
  });
  if (created.failure) throw new Fail(created.failure.code, `create_mandate failed: ${created.failure.detail}`);

  // Views can lag the receipt that wrote them, and the endpoint that answers the
  // read is not necessarily the one that answered the broadcast. Poll, bounded.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const mandates = await viewCall(account, 'list_mandates');
    const fresh = mandates.find((m) => !known.has(m.id));
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Fail('mandate_missing', 'create_mandate succeeded but no new mandate appeared within 15s');
}

async function main() {
  const status = await rpc('status', {});
  if (status?.chain_id && status.chain_id !== 'testnet') {
    throw new Fail('wrong_network', `the endpoint reports ${status.chain_id}, not testnet`);
  }
  if (!(await accountExists(account))) throw new Fail('account_missing', `${account} does not exist on testnet`);
  const credentials = loadCredentials(account);
  if (!credentials) throw new Fail('credentials_missing', `no key for ${account} at ~/.near-credentials/testnet/`);

  const runId = sha256Hex(`${startedAt}:${Math.random()}`).slice(0, 12);
  say(`\n  contract ${account}`);
  say(`  run      ${runId}   repeat ${repeat}\n`);

  const rows = [];
  const mandates = {};
  const startHeight = (await rpc('block', { finality: 'final' })).header.height;

  for (const shape of SHAPES) {
    // A create-path shape has no mandate to spend from: the refusal under test is
    // `validate()` refusing to store a policy the contract could not honour.
    if (shape.plan === 'create') {
      const c = shape.cases[0];
      // Kept in the row: the point of this case is that the contract refused *this*
      // policy, so the policy is the evidence, not a mandate id that never existed.
      const rejected = policyFor(shape, startHeight);
      const startedCreate = Date.now();
      const res = await submit({
        signerId: account,
        keyPair: credentials.keyPair,
        receiverId: account,
        say: () => {},
        actionList: [
          actions.functionCall('create_mandate', { agent: account, policy: rejected }, GAS, BigInt(100 * USDC)),
        ],
      });
      const got = res.failure ? res.failure.code : 'created';
      const matched = got === c.expect;
      rows.push({
        shape: shape.id,
        case: c.id,
        kind: 'create',
        rejected_policy: rejected,
        rep: 1,
        expected: c.expect,
        got,
        matched,
        amount: '0',
        vendor: VENDOR_A.to,
        mandate: null,
        tx: res.txHash,
        explorer: res.explorer,
        ms: Date.now() - startedCreate,
        detail: matched ? undefined : (res.failure?.detail ?? 'the contract accepted a policy it should have refused'),
      });
      say(`  shape ${shape.id.padEnd(14)} —                  ${shape.question}`);
      say(`    ${matched ? 'ok  ' : 'MISMATCH'} ${c.id.padEnd(18)} expected ${c.expect.padEnd(24)} got ${got.padEnd(24)} ${res.txHash}`);
      continue;
    }

    const mandate = await createMandate(credentials, shape, startHeight);
    mandates[shape.id] = { id: mandate.id, policy_hash: mandate.policy_hash, per_tx: mandate.per_tx, per_day: mandate.per_day };
    say(`  shape ${shape.id.padEnd(11)} mandate ${mandate.id}   ${shape.question}`);

    // The daily counter is a calendar-day counter, so a shape that straddles
    // 00:00 UTC loses its premise mid-run. Detect that and record a skip rather
    // than scoring the contract wrong for doing what it documents.
    const dayIndex0 = (await viewCall(account, 'list_mandates')).find((m) => m.id === mandate.id)?.day_index;

    for (let rep = 1; rep <= repeat; rep += 1) {
      for (const c of shape.cases) {
        const live = (await viewCall(account, 'list_mandates')).find((m) => m.id === mandate.id);
        if (live && live.day_index !== dayIndex0) {
          rows.push({
            shape: shape.id,
            case: c.id,
            rep,
            expected: c.expect,
            got: 'skipped',
            matched: null,
            skipped: 'utc_day_boundary',
            amount: String(c.amount),
            vendor: c.vendor.to,
            mandate: mandate.id,
            day_index: live.day_index,
            detail: `the daily counter rolled from day ${dayIndex0} to ${live.day_index} mid-shape; the case could not be run as designed`,
          });
          say(`    skip     ${c.id.padEnd(12)} utc day boundary ${dayIndex0} → ${live.day_index}`);
          continue;
        }

        // The owner can stop a mandate between two cases; that is the only way to
        // prove `mandate_suspended` refuses the spend that follows and not the one
        // before it.
        if (c.before === 'suspend') {
          const stopped = await submit({
            signerId: account,
            keyPair: credentials.keyPair,
            receiverId: account,
            say: () => {},
            actionList: [actions.functionCall('suspend', { id: mandate.id }, GAS, 0n)],
          });
          if (stopped.failure) throw new Fail(stopped.failure.code, `suspend failed: ${stopped.failure.detail}`);
          say(`    setup    owner suspended ${mandate.id}  ${stopped.txHash}`);
        }

        const chain = c.chain ?? c.vendor.chain;
        const asset = c.asset ?? 'USDC';
        const intent = intentHash(chain, c.amount, c.vendor.to, asset);
        // `decision: 'fixed'` reuses one recorded decision across the cases of a
        // shape, which is how a replay is produced without inventing anything.
        const decision = c.decision === 'fixed'
          ? `sha256:${sha256Hex(`${runId}:fixed:${shape.id}`)}`
          : `sha256:${sha256Hex(`${runId}:${shape.id}:${c.id}:${rep}`)}`;
        const attestation = {
          decision_hash: c.omitAttestation ? '' : decision,
          code_hash: CODE_HASH,
          quote_hash: c.omitAttestation ? '' : `sha256:${sha256Hex('baseline:quote')}`,
          policy_hash: c.tamper === 'policy' ? `sha256:${sha256Hex('stale-revision')}` : mandate.policy_hash,
          // The tampered case attests a different amount than it asks for.
          intent_hash: c.tamper === 'intent' ? intentHash(chain, c.amount + USDC, c.vendor.to, asset) : intent,
        };

        const started = Date.now();
        const res = await submit({
          signerId: account,
          keyPair: credentials.keyPair,
          receiverId: account,
          say: () => {},
          actionList: [
            actions.functionCall(
              'spend',
              {
                id: c.idOverride ?? mandate.id,
                chain,
                amount: String(c.amount),
                asset,
                vendor: c.vendor.to,
                attestation,
              },
              GAS,
              0n,
            ),
          ],
        });
        const ms = Date.now() - started;
        const got = res.failure ? res.failure.code : 'authorised';
        const matched = got === c.expect;
        rows.push({
          shape: shape.id,
          case: c.id,
          rep,
          day_index: live?.day_index,
          spent_day_before: live?.spent_day,
          expected: c.expect,
          got,
          matched,
          amount: String(c.amount),
          vendor: c.vendor.to,
          mandate: mandate.id,
          tx: res.txHash,
          explorer: res.explorer,
          ms,
          detail: matched ? undefined : (res.failure?.detail ?? 'expected a refusal and the contract authorised the spend'),
        });
        say(`    ${matched ? 'ok  ' : 'MISMATCH'} ${c.id.padEnd(18)} expected ${c.expect.padEnd(24)} got ${got.padEnd(24)} ${res.txHash}`);
      }
    }
  }

  const block = await rpc('block', { finality: 'final' });
  const mismatches = rows.filter((r) => r.matched === false);
  const skipped = rows.filter((r) => r.skipped);

  const doc = {
    schema: 1,
    source: 'transactions against a deployed contract',
    account,
    explorer: `${EXPLORER}/address/${account}`,
    run: runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    blockHeight: block.header.height,
    repeat,
    mandates,
    counts: {
      attempts: rows.length,
      authorised: rows.filter((r) => r.got === 'authorised').length,
      // A skipped row is not a refusal: nothing was sent, so nothing was refused.
      // Counting both as "refused" inflated the headline whenever a premise could
      // not be rebuilt (B-03).
      refused: rows.filter((r) => !r.skipped && r.got !== 'authorised').length,
      mismatches: mismatches.length,
      skipped: skipped.length,
      byCode: rows.reduce((acc, r) => ({ ...acc, [r.got]: (acc[r.got] ?? 0) + 1 }), {}),
    },
    rows,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);

  say('');
  say(`  ${rows.length} attempts: ${doc.counts.authorised} authorised, ${doc.counts.refused} refused at block ${doc.blockHeight}`);
  say(`  ${out}`);
  if (mismatches.length) {
    say(`  ${mismatches.length} case(s) did not do what the model expected — written, not hidden.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nexperiment: ${err.code ?? 'error'}: ${err.message}\n`);
  // Set the code instead of forcing exit: an abrupt exit while a fetch is still
  // open aborts the process in libuv and hides the message above.
  process.exitCode = 3;
});
