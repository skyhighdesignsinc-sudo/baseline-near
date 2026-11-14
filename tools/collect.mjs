#!/usr/bin/env node
// thesis/tools/collect.mjs — read a deployed contract's own views into one file.
//
// This is the baseline submission's only input. Nothing here signs, holds a key,
// or writes to chain: it calls view methods and stores exactly what they returned.
// Every figure in the write-up is derived from this file, and `make thesis`
// overwrites it — so a number that cannot be re-derived cannot survive a rerun.
//
// A failure writes no file at all. A half-written dataset that looks complete is
// worse than a typed error, because the model would silently measure nothing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const RPC = process.env.NEAR_RPC ?? 'https://rpc.testnet.near.org';
const EXPLORER = 'https://testnet.nearblocks.io';

class CollectError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  const next = argv[i + 1];
  return i >= 0 && next && !next.startsWith('--') ? next : fallback;
};

const account = arg('account', process.env.MANDATE_CONTRACT ?? '');
const out = resolve(arg('out', 'thesis/data/state.json'));

if (!account) {
  console.error('usage: node thesis/tools/collect.mjs --account <contract.testnet> [--out path]');
  process.exit(2);
}

async function rpc(method, params, timeoutMs = 30_000) {
  let res;
  try {
    res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `baseline-${Date.now()}`, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw new CollectError(timedOut ? 'rpc_timeout' : 'rpc_unreachable', `${method}: ${err.message}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new CollectError('rpc_bad_response', `${method}: HTTP ${res.status} with a non-JSON body`);
  }
  if (body.error) throw new CollectError('rpc_error', `${method}: ${body.error.message ?? 'unknown'}`);
  return body.result;
}

async function view(method, args = {}) {
  const res = await rpc(
    'query',
    {
      request_type: 'call_function',
      finality: 'final',
      account_id: account,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    },
    25_000,
  );
  try {
    return JSON.parse(Buffer.from(res.result).toString('utf8'));
  } catch {
    throw new CollectError('view_not_json', `${method} did not return JSON`);
  }
}

const started = Date.now();
try {
  const status = await rpc('status', {});
  if (status?.chain_id && status.chain_id !== 'testnet') {
    throw new CollectError('wrong_network', `the endpoint reports ${status.chain_id}, not testnet`);
  }
  const blockHeight = Number(status?.sync_info?.latest_block_height ?? 0);
  const stats = await view('stats');
  const mandates = await view('list_mandates');
  const pending = await view('list_pending');

  if (!stats || typeof stats !== 'object') throw new CollectError('view_shape', 'stats is not an object');
  if (!Array.isArray(mandates)) throw new CollectError('view_shape', 'list_mandates is not an array');
  if (!Array.isArray(pending)) throw new CollectError('view_shape', 'list_pending is not an array');

  const doc = {
    schema: 1,
    source: 'contract views, read over RPC',
    account,
    explorer: `${EXPLORER}/address/${account}`,
    collectedAt: new Date().toISOString(),
    blockHeight,
    elapsedMs: Date.now() - started,
    counts: {
      mandates: mandates.length,
      pending: pending.length,
      settled: stats.total_settled ?? null,
    },
    stats,
    mandates,
    pending,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);

  console.log(`collected ${mandates.length} mandates, ${pending.length} pending at block ${blockHeight}`);
  console.log(`  ${out}`);
  console.log(`  ${doc.explorer}`);
  if (!Number(stats.total_mandates ?? 0)) {
    console.error('  warning: total_mandates is 0 — there is nothing to measure yet');
  }
} catch (err) {
  const code = err instanceof CollectError ? err.code : 'unexpected';
  console.error(`collect_failed: ${code} ${err.message}`);
  console.error('  no file written; the previous dataset is untouched');
  process.exit(3);
}
