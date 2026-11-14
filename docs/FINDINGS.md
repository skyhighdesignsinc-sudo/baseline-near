# Findings

Each finding is one measured behaviour of the deployed contract, with the transactions
that show it. Where the source is cited, it explains what a transaction proves; the
transaction is the evidence.

---

## F-1 — the daily ceiling never bound: a "day" was 86.4 ms long

**Discovered by** the matrix, not by reading code. Case `daily/second_10` expected
`per_day_exceeded` and the contract authorised the spend.

**Set up (pre-fix build):** mandate `m7`, `per_tx 20,000,000`, `per_day 25,000,000`
(25 USDC at 6 decimals), funded with 100 USDC.

| # | amount | expected | observed | tx |
|---|---|---|---|---|
| 1 | 20 USDC | authorised | authorised | *(id not recorded)* |
| 2 | 10 USDC | `per_day_exceeded` | **authorised** | *(id not on chain)* |

**Why those two cells have no hash.** The ids this run wrote were computed locally before
`tools/near-tx.mjs` was fixed to record the node's canonical `transaction.hash`, and neither
resolves on testnet. A hash that does not resolve is not evidence, so they are removed rather
than kept as decoration. What is left is the contract view below, which is the actual
observation, and the regression test that fails without the fix. The post-fix rows further
down *are* on chain and were re-checked.

20 + 10 exceeds the 25 USDC ceiling, so the second spend should have been refused. The
contract view afterwards:

```
spent_total 30000000     both spends were debited
spent_day   10000000     only the second counts against "today"
day_index   20764932355
```

**Root cause.** `spend` compares `spent_day + value` against `per_day` only after
`roll_day(day_index)`, where `day_index = env::block_timestamp() / DAY_MS` and
`DAY_MS = 86_400_000`. `block_timestamp()` is **nanoseconds** — `near_sdk::env` ships
`block_timestamp_ms()` because this is easy to get wrong — so one "day" was 86.4 ms and
the counter reset between consecutive blocks.

**Arithmetic, not opinion.** `20764932355 × 86_400_000 = 1 794 090 155 472 000 000`,
and that value reads as `2026-11-07T22:22:35Z` only when treated as nanoseconds. The
counter also moved ~195 between two calls seconds apart (195 × 86.4 ms ≈ 17 s).

**Fixed** (D-020, `76th…` deploy `77th4RrA1DQQzxLVXQ6Ag2K6EnhHyqcBP3v47gXTLBVk`):
`DAY_NS = 86_400_000_000_000`, plus the regression test `daily_ceiling_spans_blocks`
(two spends one second apart must hit the ceiling). 28 contract tests pass.

**Same case, after the fix** — run `11873d9d899d`, block 277664211:

| # | amount | expected | observed | tx |
|---|---|---|---|---|
| 1 | 20 USDC | authorised | authorised | `7n6KhL91pHTmXxdQ3hsXZb6hfZGccwc3MeX2Bzq7Fcst` |
| 2 | 10 USDC | `per_day_exceeded` | `per_day_exceeded` | `4idQpYLo3yH792972Y9d2PESDBeaAvADPjpDPignN7p6` |

Both of these resolve; they are re-checked by `node tools/check-evidence.mjs data/spends.json`
(24/24) and by `make thesis-e2e ARGS=--online`.

**Why this counts as a finding and not a footnote.** Before the fix, submission #1 would
have shipped a per-day ceiling that refused nothing, which is the first claim a security
judge tests. The matrix found it in its first run, on the third shape.

**What is measured, what is inferred.** The rows, codes, view values and arithmetic are
read from the chain. The wall-clock gap between the two pre-fix transactions is *not*
measured: the timestamp lookup timed out, so the dataset records per-call submission
latency rather than block times. The ordering is the run order.

**A remaining gap in the policy language, not a bug.** The ceiling is a UTC *calendar*
day, not a rolling 24 hours: a spend either side of 00:00 UTC can use the full cap twice.
That follows from the day-index definition; it is not demonstrated by a transaction here
and is labelled as inference wherever it appears.

---

## F-2 — the matrix's own coverage, stated plainly

Run `11873d9d899d`: 24 attempts, 8 authorised, 16 refused, 0 mismatches, 0 skipped, block
277664211.
Fourteen policy shapes, one transaction per case, every row a hash on testnet.

Codes observed, 17 distinct: `authorised`, `per_tx_exceeded`, `per_day_exceeded`,
`per_counterparty_day_exceeded`, `counterparty_not_allowed`, `amount_zero`,
`asset_mismatch`, `chain_not_enabled`, `mandate_suspended`, `mandate_expired`,
`budget_exhausted`, `attestation_mismatch`, `attestation_required`,
`decision_replayed`, `policy_changed`, `not_found`, `policy_invalid`.

**What is now claimable.** Every refusal code `spend` can emit appears in the matrix at
least once, plus `policy_invalid` on the create path. The per-counterparty ceiling, funded
balance exhaustion, suspension, expiry, the asset and chain checks and decision replay
each have a transaction refused for that reason — and, where the shape needs it, an
authorised transaction before the refusal to show which one the rule bound.

Two rows worth opening directly: `GewJX6kgCcsU9HhJVWPEuhFFEr966u3k5pcd8vKWvEjL` is the spend
refused because the owner had just suspended the mandate, and
`C6484KFSj29c2aKGFqyuaeSSRo3u8ZLeuTNKSQVX9bQA` is the spend refused because the policy had
expired.

**What this still does not cover.** `owner_only`, `attestor_only`, `request_not_pending`,
`unauthorized` and `access_key_missing` are not reachable from `spend`: they belong to the
owner, attestor and key paths, and the contract unit tests cover them, not this matrix.
The `approve`/`reject` queue is unit-tested for the same reason. And 24 attempts is one
run: the counts above are per-run observations, not rates, and a second run is what would
turn them into a distribution.

---

## F-3 — the field's own agent accounts: three of six still hold a full-access key

**Why this is here.** F-1 and F-2 measure whether a policy refuses. This measures the layer
underneath: whether the agent can bypass the contract entirely by holding a key the policy
cannot see. A vault whose agent keeps a full-access key enforces nothing against that agent.

**Method.** The eleven comparable repositories audited on 2026-11-13 (`UNIQUENESS-AUDIT.md`
§4.4) name their testnet accounts in their READMEs. Those account ids were read, then
`view_access_key_list` was called for each over public testnet RPC. Eleven shared
infrastructure accounts that the READMEs mention in instructions (`rpc.testnet`,
`wrap.testnet`, `helper.testnet`, …) are excluded by name, and the exclusion list is in the
data file. Reproduce with `make thesis-hygiene` → `thesis/data/hygiene.json`.

**Observed** (block height is recorded in the data file):

| Measure | Value |
|---|---|
| Project accounts named across the eleven repos | **24** |
| …that still hold a `FullAccess` key | **16** |
| …that expose a `FunctionCall` key with **no method restriction** | **7** |
| Accounts named as agents | **6** |
| …agents that hold a `FullAccess` key | **3** |

**The number that matters** is the last row. Every one of those vaults exists to make "the
agent cannot move money without you" true. Three of the six accounts their own READMEs
present as the agent still hold a key that can do anything the account can, including
bypassing the contract.

**Our own account is in the same position, and the data file says so.**
`mandate-hackaton-7c1a.testnet` holds one full-access key (`full=1`), because this machine
deploys with it. The difference we claim is narrower than "we practise perfect hygiene":
C25 is about the **agent's** key, which `revoke_key` deletes, and our agent is not the
contract account.

**What this does not show.** The sample is eleven repositories and 24 accounts. The "agent"
label is inferred from the account id, and some of those accounts may be owner or demo
accounts. Testnet deploy keys are commonly left in place because the account is disposable.
This is an observation about published demos, not a vulnerability report about anyone's
product, and it is not a claim that any account here is exploitable. One audited repo
(`kyrona`) published no testnet account at all — it is on mainnet — so it contributes none
of these rows.
