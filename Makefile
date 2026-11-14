# Baseline — the commands the README and JUDGE.md name.
#
# Every target here exists because a document tells a judge to run it. A target
# that called a missing script would be a lie in a README, which is why this
# file exists at all: the published tree used to document `make thesis-e2e` and
# ship no Makefile (B-01).
SHELL := /bin/bash
NODE ?= node
ACCOUNT ?= mandate-hackaton-7c1a.testnet

.PHONY: help thesis thesis-e2e thesis-hygiene site e2e evidence check

help:
	@echo "make thesis        read the deployed contract into data/state.json (no signing)"
	@echo "make thesis-e2e    dataset <-> JSON <-> prose; ARGS=--online re-queries every tx"
	@echo "make thesis-hygiene what the field's published accounts hold (read-only)"
	@echo "make evidence      resolve every hash in data/spends.json"
	@echo "make site          the judge view on http://127.0.0.1:4180"
	@echo "make e2e           Playwright against that page"
	@echo "make check         evidence + artefacts + page tests, in that order"

thesis:
	@$(NODE) tools/collect.mjs --account $(ACCOUNT)

# The experiment writes to testnet, so it is not part of `make check`: a judge
# without credentials must be able to run everything else.
experiment:
	@$(NODE) tools/experiment.mjs --account $(ACCOUNT) $(ARGS)

thesis-e2e:
	@$(NODE) tools/e2e.mjs $(ARGS)

thesis-hygiene:
	@$(NODE) tools/hygiene.mjs

evidence:
	@$(NODE) tools/check-evidence.mjs data/spends.json

site:
	@$(NODE) tools/serve-static.mjs 4180

e2e:
	@npx playwright test

check: evidence thesis-e2e e2e
	@echo "check: evidence, artefacts and page tests all passed"
