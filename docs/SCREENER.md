# SCREENER — baseline

A hostile reviewer with no context should be able to check the dataset without reading
any other file. Every row below is a literal act followed by what you see.

## 1. Read the live contract into a file

```bash
node thesis/tools/collect.mjs --account mandate-hackaton-7c1a.testnet
```

→ prints `collected 5 mandates, N pending at block <height>` and writes
`thesis/data/state.json`. Open the file: `account`, `blockHeight`, `collectedAt` and
`explorer` identify the exact chain state, and `mandates[]` is the contract's own
`list_mandates` payload, not a summary.

Check it against the chain yourself: open
<https://testnet.nearblocks.io/address/mandate-hackaton-7c1a.testnet> and compare the
mandate count with `counts.mandates`.

## 2. Watch it refuse to invent data

```bash
node thesis/tools/collect.mjs --account no-such-account-xyz.testnet
```

→ `collect_failed: rpc_error ...`, exit code `3`, and **no file written**. The previous
dataset is still on disk, unchanged. This is the difference between a measurement and a
mock: the collector would rather fail than write a plausible zero.

```bash
node thesis/tools/collect.mjs
```

→ usage line, exit code `2`. It will not guess an account.

## 3. Confirm nothing here can spend

```bash
grep -rn "sign\|KeyPair\|secret\|private" thesis/tools/ | grep -v "^thesis/tools/collect.mjs:.*//"
```

→ no hits outside comments. The collector makes two RPC calls (`status`, `query` with
`call_function`) and writes one local file.

## 4. What this repository does not claim yet

- No model and no write-up. The table in `README.md` says so. The experiment exists and
  has run once (24 attempts); one run is not a distribution.
- ~~No coverage of the refusal surface~~ **closed 2026-11-13**: all sixteen refusal codes
  `spend` can emit now appear in the matrix (run `11873d9d899d`), plus `policy_invalid` on
  the create path. The five codes on the owner, attestor and key paths (`owner_only`,
  `attestor_only`, `request_not_pending`, `unauthorized`, `access_key_missing`) remain
  unit-tested only, and `FINDINGS.md` F-2 says so.
- No comparison table of other implementations. Citing what a competitor's docs say is
  not measuring it, and the write-up must label the difference.
- No mainnet behaviour.

## 5. Run the spend matrix

```bash
node thesis/tools/experiment.mjs --account mandate-hackaton-7c1a.testnet
```

→ creates one mandate per shape (per-transaction cap, daily ceiling, allowlist,
attestation binding, suspension, expiry, asset, chain, per-counterparty ceiling, funded
balance, missing attestation, decision replay, unknown id, invalid policy), then executes
24 attempts. Each line prints `ok` or `MISMATCH`,
the expected code, the observed code, and the transaction hash. It writes
`thesis/data/spends.json` with every row: `tx`, `explorer`, `expected`, `got`, latency.

Open any row's `explorer` link: an authorised row is a successful `spend`, a refused
row is a failed transaction whose receipt log contains `violation: <code>`. That log is
the only reason a refusal is auditable here — the release profile is compiled with
`panic = "abort"`, which strips the panic message.

A case that does not match its expectation still gets written, and the run exits `1`.
A measurement that hides its surprises is not a measurement.

```bash
node thesis/tools/experiment.mjs --account mandate-hackaton-7c1a.testnet --repeat 5
```

→ five attempts per case (50 transactions). Repetition is how the model gets a spread
rather than a single observation; `counts.byCode` in the file is the distribution.

## 8. `make thesis-e2e` — the artefacts must agree with each other

```bash
make thesis-e2e                  # offline: no RPC, no secrets
make thesis-e2e ARGS=--online    # also asks testnet whether every tx exists
```

→ eight checks pass, ending in `24 rows, 16 refusals, one run — artefacts agree`. It exits
`1` when: a row has no tx or no absolute explorer link, a recorded outcome differs from
its expectation, `counts` cannot be recomputed from the rows, `state.json` describes a
different contract, the numbers quoted in `FINDINGS.md` or `README.md` stop matching the
dataset, or a hash cited in the prose belongs to none of: the dataset, the fix deploy, the
pre-fix run. `--online` exits `3` when no testnet endpoint answers, so an outage is never
reported as a pass.

Why it exists: the claim is that every figure is re-derivable and every hash is public.
That claim is worth exactly as much as the command that fails when it stops being true.

## 9. `make thesis-hygiene` — the layer under the policy

```bash
make thesis-hygiene
```

→ prints one line per audited repository and then:

```
  24 project accounts (11 shared excluded)
  full access key still present: 16
  function-call key with no method restriction: 7
  agent-named accounts: 6, with full access: 3
  self (mandate-hackaton-7c1a.testnet): full=1 functionCall=0
```

and writes `thesis/data/hygiene.json`: every account, its key counts, the largest
allowance, the block height and the list of shared accounts that were excluded. It fails
with `wrong_network` if the endpoint is not testnet, and exits `3` if no endpoint answers.

The number to look at is the last one in the summary: accounts their own READMEs present as
the *agent*. Three of six hold a key that can bypass the contract. `FINDINGS.md` F-3
states the limits of that observation, including that our own contract account also holds a
deploy key.
