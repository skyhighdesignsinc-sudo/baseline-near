# Evidence check — 2026-11-14

This file exists because a submission almost shipped with transaction links that opened to
nothing. It records what broke, how it was found, what was fixed, and what is still not claimed.

## What was wrong

`tools/near-tx.mjs`, `thesis/tools/near.mjs` and the copies under `publish/` computed a
transaction id as `base58(sha256(SignedTransaction.encode()))` and recorded it **before**
asking the chain anything. The node re-serialises the transaction canonically before hashing,
so the two values can differ while the call still succeeds.

Consequence: 24 rows in `thesis/data/spends.json` and 8 hashes in the console's `chain.json`
carried well-formed ids for transactions the chain had mined under different ids. The links
were dead. Nothing about the contract's behaviour was wrong; the *evidence pointer* was.

Found by running the repository's own online check, which failed every row, then by walking
blocks 277,558,600–800 and observing that the account really did make those calls — with
different hashes. Control experiment: one transaction sent through `submit()` returned
`computed AM7Auzvd…` while the node reported `472HVy6x…` for the same successful call.

## What was fixed

| File | Change |
|---|---|
| `tools/near-tx.mjs` | returns the node's `transaction.hash` when present; prints when the local id disagreed |
| `thesis/tools/near.mjs`, `publish/baseline/tools/near.mjs` | same |
| `tools/chain-demo.mjs` | polls `list_mandates` for the new mandate instead of reading once (a view can land one block behind) |
| `tools/check-evidence.mjs` | new: every cited hash is resolved over RPC; exits 1 on a miss, 2 if inconclusive |

The datasets were regenerated against the live contract rather than patched, and the console's
`chain.json` was rebuilt from one fresh, fully verified run.

## Results

```
node tools/check-evidence.mjs thesis/data/spends.json
  24 of 24 resolve                                exit 0

node tools/check-evidence.mjs mandate/console/data/chain.json
  4 of 4 resolve                                  exit 0

node tools/check-evidence.mjs publish/mandate/JUDGE.md
  4 of 4 resolve                                  exit 0

node thesis/tools/e2e.mjs
  24 rows, 16 refusals, one run — artefacts agree  exit 0
```

Rebuilt run: `11873d9d899d`, block 277,664,211, 24 attempts, 8 authorised, 16 refused,
0 mismatches. Every row carries a hash that resolves.

## Withdrawn, not softened

`tools/contest-demo.mjs` now fails its own assertion (`C26 FAILED: the observed states do not
match the claim`), so **C26 — the contest window — is not claimed** in this submission.
`C27` (caller bound to the named agent) is covered by the contract unit test
`only_the_named_agent_can_request_a_spend` and has no live link yet. Both are stated in
`publish/mandate/JUDGE.md` rather than deleted, because a judge will find them by grep.

## Reproduce

```bash
node tools/check-evidence.mjs thesis/data/spends.json        # needs a public RPC, no key
node thesis/tools/e2e.mjs                                    # offline
```

If `check-evidence` exits non-zero, a claim in this repository is wrong. That is the point of it.
