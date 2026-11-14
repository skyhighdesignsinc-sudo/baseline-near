// thesis/tools/near.mjs — the transaction layer for the experiment.
//
// This is a deliberate copy of the signing rules, not an import from the other
// submission: each repository has to stand alone for the screener. Two details
// are written down once because each costs an hour to rediscover:
//
//   * the protocol signs sha256(serialized transaction), not the bytes;
//   * `broadcast_tx_commit` wants base64, while the transaction id is
//     base58(sha256(bytes)).
//
// Keys live in ~/.near-credentials/testnet/<account>.json, outside this
// repository. Nothing here prints a private key.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  KeyPair,
  Signature,
  SignedTransaction,
  base64Encode,
  baseDecode,
  baseEncode,
  createTransaction,
  encodeTransaction,
} from 'near-api-js';

export const RPC = process.env.NEAR_RPC ?? 'https://rpc.testnet.near.org';
export const EXPLORER = 'https://testnet.nearblocks.io';

export class Fail extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const sha256 = (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest());
export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Mirrors the contract: sorted-key JSON of (amount, asset, chain, vendor). */
export const intentHash = (chain, amount, vendor, asset) =>
  sha256Hex(JSON.stringify({ amount: String(amount), asset, chain, vendor }));

async function rpcOnce(endpoint, method, params, timeoutMs = 30_000) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `baseline-${Date.now()}`, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw timedOut
      ? new Fail('rpc_timeout', `${method} got no answer in ${Math.round(timeoutMs / 1000)}s`)
      : new Fail('rpc_unreachable', `cannot reach ${endpoint}: ${err.message}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Fail('rpc_bad_response', `${endpoint} answered ${res.status} with a non-JSON body`);
  }
  if (body.error) throw new Fail('rpc_error', `${method}: ${body.error.message}`);
  return body.result;
}

// Public testnet endpoints answer 503/"Server error" often enough that a single
// attempt turns a healthy chain into a failed measurement. Retry transient faults;
// never retry a view that answered with a contract error.
async function rpcAt(endpoint, method, params, timeoutMs = 30_000, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await rpcOnce(endpoint, method, params, timeoutMs);
    } catch (err) {
      lastErr = err;
      // A deprecation notice is terminal for that endpoint, not transient.
      if (i === attempts || /DEPRECATED/i.test(String(err.message ?? ''))) break;
      await new Promise((r) => setTimeout(r, 700 * i));
    }
  }
  throw lastErr;
}

// Public testnet endpoints are being retired mid-hackathon: the historical
// default now answers "THIS ENDPOINT IS DEPRECATED" as a JSON-RPC *error*, for
// reads as well as broadcasts. Any call therefore walks the list; reads are
// idempotent, and a broadcast is safe to repeat because a transaction can only
// land once.
// Only testnet endpoints here. `free.rpc.fastnear.com` was tried and rejected:
// it answers with mainnet height (223M vs 276M), and a client that cannot tell
// the two apart would report the wrong chain's state as this contract's.
export const ENDPOINTS = [...new Set([RPC, 'https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'])];

export async function rpc(method, params, timeoutMs = 30_000) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    try {
      return await rpcAt(endpoint, method, params, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function viewCall(accountId, method, args = {}) {
  const res = await rpc(
    'query',
    {
      request_type: 'call_function',
      finality: 'final',
      account_id: accountId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    },
    25_000,
  );
  return JSON.parse(Buffer.from(res.result).toString('utf8'));
}

export async function accountExists(accountId) {
  try {
    await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId }, 25_000);
    return true;
  } catch (err) {
    // "the account does not exist" and "the RPC failed" are different facts, and a
    // harness that conflates them reports a healthy chain as missing. Only the
    // first answers false; everything else propagates.
    const text = String(err.message ?? '');
    if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(text)) return false;
    throw err;
  }
}

export const credentialsPath = (accountId) => join(homedir(), '.near-credentials', 'testnet', `${accountId}.json`);

export function loadCredentials(accountId) {
  const file = credentialsPath(accountId);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { keyPair: KeyPair.fromString(parsed.private_key), file };
}

async function headBlockHash() {
  const block = await rpc('block', { finality: 'final' }, 25_000);
  return baseDecode(block.header.hash);
}

// Access-key nonces advance only once a transaction is included, so rapid calls
// would otherwise reuse one nonce and later ones would be dropped as invalid —
// which looks like a contract refusal and is not one.
const nonceCache = new Map();

async function nextNonce(accountId, publicKey) {
  const cacheKey = `${accountId}:${publicKey.toString()}`;
  const cached = nonceCache.get(cacheKey);
  if (cached !== undefined) {
    const next = cached + 1n;
    nonceCache.set(cacheKey, next);
    return next;
  }
  const key = await rpc(
    'query',
    { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey.toString() },
    25_000,
  );
  const next = BigInt(key.nonce) + 1n;
  nonceCache.set(cacheKey, next);
  return next;
}

/**
 * Pull a typed refusal out of a failed transaction.
 *
 * The release profile sets panic = "abort", so the panic message is stripped and
 * the code survives only in the receipt log (`violation: <code>`). `tx_failed`
 * is kept for failures that are not a policy decision (bad nonce, no gas), so
 * the two can never be confused in the dataset.
 */
export function extractFailure(outcome) {
  const parts = [];
  if (outcome.status?.Failure) parts.push(JSON.stringify(outcome.status.Failure));
  for (const r of outcome.receipts_outcome ?? []) {
    if (r.outcome?.status?.Failure) parts.push(JSON.stringify(r.outcome.status.Failure));
  }
  if (!parts.length) return null;
  const text = parts.join(' ');

  const logs = [];
  for (const r of outcome.receipts_outcome ?? []) logs.push(...(r.outcome?.logs ?? []));
  logs.push(...(outcome.transaction_outcome?.outcome?.logs ?? []));

  const fromLog = logs.join('\n').match(/violation:\s*([a-zA-Z_]+)/);
  const fromMessage = text.match(/PolicyViolation:\s*([a-zA-Z_]+)/);
  const code = fromLog ? fromLog[1] : fromMessage ? fromMessage[1] : 'tx_failed';
  return {
    code,
    detail: `${text.slice(0, 240)}${logs.length ? ` | logs: ${logs.slice(-3).join(' / ').slice(0, 240)}` : ''}`,
  };
}

async function waitForTx(txHash, senderId) {
  const deadline = Date.now() + 150_000;
  for (;;) {
    try {
      const outcome = await rpc('tx', { tx_hash: txHash, sender_account_id: senderId, wait_until: 'EXECUTED_OPTIMISTIC' }, 25_000);
      return outcome.transaction_outcome ? outcome : { ...outcome, transaction_outcome: { id: txHash } };
    } catch (err) {
      if (Date.now() > deadline) throw new Fail('tx_not_found', `${txHash} not found in 150s (${err.message})`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

export async function submit({ signerId, keyPair, receiverId, actionList, say = () => {} }) {
  const publicKey = keyPair.getPublicKey();
  const tx = createTransaction(
    signerId,
    publicKey,
    receiverId,
    await nextNonce(signerId, publicKey),
    actionList,
    await headBlockHash(),
  );
  const signature = new Signature({
    keyType: publicKey.keyType,
    data: keyPair.sign(sha256(encodeTransaction(tx))).signature,
  });
  const bytes = new SignedTransaction({ transaction: tx, signature }).encode();
  const txHash = baseEncode(sha256(bytes));
  const explorer = `${EXPLORER}/txns/${txHash}`;
  say(`  ${txHash}  ${explorer}`);

  // Public testnet endpoints reject broadcasts at different moments: one returns a
  // deprecation notice as a JSON-RPC error, another answers "Server error" under
  // load. Broadcasting the same signed bytes again is safe — a transaction can
  // only land once — so falling through the list cannot duplicate a spend.
  let outcome;
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    try {
      outcome = await rpcAt(endpoint, 'broadcast_tx_commit', [base64Encode(bytes)], 120_000);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (err.code === 'rpc_timeout') break; // it may still land; poll for the receipt below
    }
  }
  if (!outcome) {
    if (lastErr?.code === 'rpc_timeout') {
      outcome = await waitForTx(txHash, signerId);
    } else {
      throw new Fail(
        lastErr?.code ?? 'broadcast_failed',
        `no endpoint accepted the broadcast: ${lastErr?.message ?? 'unknown'}`,
      );
    }
  }
  return { txHash, explorer, failure: extractFailure(outcome), outcome };
}
