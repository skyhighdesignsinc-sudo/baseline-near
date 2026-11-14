# Ninety seconds

Two submissions, kept apart on purpose. This file is the fast path for a reviewer who has a
thousand entries to read.

| | |
|---|---|
| **`mandate`** | An agent gets a budget and an allowlist the contract enforces, an attested reason for every spend, and a kill switch that deletes the agent's key. |
| **`baseline`** | The measurement: we ran a policy contract against 24 cases to see which refusals actually bind, found that one did not, fixed it, and published every hash. |

They are not the same project twice. One is the product; the other is the instrument that says
whether products like it refuse what they claim.

## Four transactions, clicked not claimed

Every hash below is a row in `data/spends.json`, re-checked against a public RPC by
`node tools/check-evidence.mjs data/spends.json` (24/24 resolve). Open any of them at
`https://testnet.nearblocks.io/txns/<hash>`.

| What it shows | Transaction |
|---|---|
| A spend inside the policy is authorised (10 USDC, `per_tx/inside`) | `Ed1DsVvZF6bCF962apcjPJrYHFZu8VF5m3tSptj5poHu` |
| The daily ceiling binds: 20 USDC passes, the next 10 is refused `per_day_exceeded` | `7n6KhL91pHTmXxdQ3hsXZb6hfZGccwc3MeX2Bzq7Fcst` → `4idQpYLo3yH792972Y9d2PESDBeaAvADPjpDPignN7p6` |
| The per-counterparty ceiling binds: 8 USDC to one vendor passes, the next 8 is refused `per_counterparty_day_exceeded` | `CrC1hiXXHf9QUnE5LjpR4YmVvpGym9HEBt7dx4sbznEV` → `Awq7ureY5RmC17c7pw6pp4FFzMmV6kJ1nZouyTBZSaJF` |
| Suspension binds: a spend before `revoke` passes, the same spend after it is refused `mandate_suspended` | `CZmTWZb85yJ3BpmaJCzxhT5oizG4rXjvxAbhiNkjrdoG` → `GewJX6kgCcsU9HhJVWPEuhFFEr966u3k5pcd8vKWvEjL` |

The **pre-fix** transaction — the one that was wrongly authorised because a "day" was 86.4 ms
long — is deliberately absent from this table. The id recorded for it was computed locally
rather than read from the node, so it does not resolve, and a hash that does not resolve
proves nothing. What survives from it is the contract view it left, quoted in
`docs/FINDINGS.md` F-1, and the regression test that now fails without the fix.

## One command

```bash
make thesis-e2e       # 24 rows, 16 refusals, one run — artefacts agree
```

It is offline and needs no key: it compares `data/spends.json`, `data/state.json` and the
sentences in `docs/FINDINGS.md` against each other, and exits non-zero the moment one of
them drifts. `ARGS=--online` additionally asks a testnet node whether every hash exists.

## What is actually different, measured against the nearest eleven entries

Audited 2026-11-13 against the eleven most comparable repositories; method and per-project rows
in `docs/UNIQUENESS-AUDIT.md` §4.4 and the full 1,098-entry census in §4.7.

| Mechanism | In the field | Here |
|---|---|---|
| Spending caps, allowlist, per-day ceiling | 11 of 11 | yes |
| Typed refusal code left in the failed receipt | common | yes, and the matrix exercises 17 codes |
| `settle` records a foreign tx reference | common | yes |
| **Every refusal code `spend` can emit appears in one re-runnable run** | **0 of 11** | yes (F-2: 24 cases, 16 refusals) |
| **A published defect in the architecture, with the fix and the re-measurement** | **0 of 11** | yes (F-1: 86.4 ms "day") |
| **Accounts named as agents that still hold a full-access key — measured, not asserted** | **0 of 11 publish the check** | 3 of 6 (F-3, `make thesis-hygiene`) |
| Pre-flight dry run before signing | 1 of 11 (`agentshield`) | no |
| Key expiry / lease | 1 of 11 (`leash-near`) | no |

The last two rows are there on purpose. A comparison table that only lists your wins is
advertising.

## Try to break it

`docs/SCREENER.md` §10 lists the attempts with the code each should answer with: over-cap
(`per_tx_exceeded`), over-day (`per_day_exceeded`), unlisted vendor
(`counterparty_not_allowed`), wrong asset (`asset_mismatch`), a decision whose hash does not
match (`attestation_mismatch`). If one returns something else, the claim table is wrong and
you should read the repository as broken.

Two cases are **not** reachable from `spend` and are covered by unit tests instead:
`unauthorized` (a non-agent caller) and `access_key_missing` (a deleted key). The matrix
does not claim them.

## What we do not claim

No mainnet, no audit, no custody. The attestor is a trusted component: the contract compares
a hash and does not verify a signature (C24). **The matrix measures one contract, and that
contract is submission #1's** — that is disclosed in the README and it is the honest limit
of the independence argument. The 24 attempts are one run, not a distribution: the counts are
per-run observations.

## Why the numbers can be checked at all

`docs/CLAIMS.md` is the only list of sentences allowed in a README, a UI or a video, and every
row names the artefact that proves it. `make thesis-e2e` fails when the prose and the dataset
disagree, and `tools/check-evidence.mjs` fails when a hash stops resolving — which is how the
dead hashes this file used to carry were found. The release profile is compiled with
`panic = "abort"`, so a refusal's message is gone by the time a node reports it; the code
survives in the receipt log, which is why every refusal is greppable on chain.
