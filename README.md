# Baseline — what agent-payment policies can and cannot refuse

Submission #2 for NEAR HACKATHON 2026. Tracks: `security` (primary), `thesis` (secondary).
The security case is the one this repository actually makes: a deployed policy contract, a
matrix of what it refuses, and a defect the matrix found. The `thesis` track asks for a
long-term investment thesis backed by on-chain analytics; what exists here is one 24-row run
and a finding, not an investment thesis, and `docs/FINDINGS.md` says so where it matters.

The public directory for this event lists **1043 submissions**. Of the first 480 with
track data, **229 are in `security`**; of the 560 sampled, **74** use spending-policy
vocabulary in their name and **four are called Mandate**. Each of those entries — and each
of the six shipping systems beside them: NEAR Intents' Agent API, contract mandates, TEE
custody, wallet policy engines, session keys, consensus covenants — publishes what it can
refuse. None publishes a re-runnable matrix over its own policy surface.

This repository is that matrix, aimed at one deployed contract: fourteen policy shapes, 24
attempts, each row carrying a typed refusal code or a transaction hash, and a command that
fails when the numbers and the prose stop agreeing. It found a real defect: a 25 USDC daily
ceiling that authorised 30 USDC, because a "day" was 86.4 milliseconds long. Fixed,
redeployed and re-measured (`docs/FINDINGS.md` F-1).

The pre-fix transaction itself is **not** cited: the id recorded for it was computed locally
and does not resolve on chain, so it was removed rather than kept as decoration. What proves
the defect is the contract view it left (`spent_day` resetting between blocks) and the
regression test that fails without the fix; what proves the repair is the post-fix pair
`7n6KhL91…` → `4idQpYLo…`, where the same policy refuses `per_day_exceeded`. Every hash that
appears anywhere in this repository is re-checked by `node tools/check-evidence.mjs`.

What this is **not**: the first re-runnable artefact in this event — other entries
regenerate their figures from RPC, so re-runnable evidence is a style, not a differentiator.
The claim here is narrower, and it is the only one made: the subject is enforcement rather
than economics, and the payload is a defect found by measuring, not an opinion formed by
reading.

## Status — read this before the claim

| Piece | State |
|---|---|
| collector (`tools/collect.mjs`) | **built and run** against `mandate-hackaton-7c1a.testnet`; writes `data/state.json` from contract views |
| experiment (`tools/experiment.mjs`) | **built and run**: 14 policy shapes, 24 attempts, block 277664211 — 8 authorised, 16 refused, 0 mismatches |
| first finding (`docs/FINDINGS.md` F-1) | the daily ceiling never bound; root cause found, fixed, redeployed, and re-measured |
| second finding (`docs/FINDINGS.md` F-3) | the field's own accounts: 16 of 24 keep a full-access key, and **3 of the 6 accounts presented as the agent** do too (`make thesis-hygiene`) |
| model (derived figures) | not written — the counts above are per-run observations, not rates |
| write-up | not written |

No rate or comparative claim is made yet. Every number that exists comes from
`data/state.json` or `data/spends.json`, and the 24 attempts are one run, not a
distribution.

## Run it

```bash
npm install                           # near-api-js, playwright
node tools/collect.mjs --account mandate-hackaton-7c1a.testnet
```

or, from the repository root:

```bash
make thesis ACCOUNT=mandate-hackaton-7c1a.testnet
make thesis-e2e                       # dataset ↔ JSON ↔ prose; ARGS=--online re-queries every tx
make e2e                              # the judge view, executed rather than eyeballed
```

That writes `data/state.json`: the contract's `stats`, `list_mandates` and
`list_pending` views, the block height they were read at, and the address they came from.
It reads; it never signs. With no network it exits `3` with a typed code
(`rpc_unreachable`, `rpc_timeout`, `view_not_json`, `view_shape`) and leaves the previous
file untouched.

## What this is not

- Not a product claim. If the measurement shows a funded-balance mandate costs more per
  enforced spend than a session key, that goes in the write-up.
- Not a re-run of the Mandate console. It shares no contract, no code and no buyer with
  submission #1; it reads a deployed contract as one data source among several.
- Not a claim about mainnet. Everything here is testnet, and the footer says so.

## Media

- `media/baseline-matrix.mp4` — 59-second recording of the result matrix and the refusal table
  on the judge site, with the same numbers the artefacts carry. One take, no cuts on figures.

## Licence

MIT. Third-party names are cited, not endorsed.

## Sibling project (rule Q-015)

This is submission #2 of two. The other is **Mandate**, in the parent repository
(`../README.md`): an agent spending authority where the budget is a contract balance and
the reason for each spend is a decision hash the contract checks. The two are independent:
this one shares no code with Mandate and only reads Mandate's deployed testnet contract as
a subject to measure. Disclosed here because the rules allow two submissions per person
only when each README names the other.
