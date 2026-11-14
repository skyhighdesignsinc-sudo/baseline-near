# The baseline film — narration, timings, and how it was recorded

The video is `media/baseline-matrix.mp4`, 63.0 s, 1280×720, 25 fps, narration over a
recording of the public judge view. It is also served at
`https://skyhighdesignsinc-sudo.github.io/baseline-near/media/baseline-matrix.mp4`.

## Why it is a recording of the page and not of a desktop

The published tree is CLI-only apart from `site/`, so there is no terminal moment worth
filming. A desktop capture would also record whatever else was open on the machine, which
is how demo videos end up showing a judge somebody's email. The recorder drives a headless
browser at `1280×720` against the public URL, so the film shows exactly the page a judge
loads, and the file is reproducible by anyone with the command below.

## Narration

Voice: `en-US-AndrewNeural`, rate `+3%`, generated with `edge-tts` (no account, no key
stored in the repository). Five segments, each timed to the state it describes; the yellow
box is placed on the same state at the start of each line.

| Start | On screen | Line |
|---|---|---|
| 0:00.4 | counts 24 attempts / 8 authorised / 16 refused | "This is Baseline. We measured an agent spending policy instead of describing it: twenty-four spends against a contract on NEAR testnet. Eight execute. Sixteen are refused, each with a typed code inside a failed transaction." |
| 0:15.0 | the matrix header and its "click any row" hint | "The matrix is the run, case by case. Click any row to see the amount, the code and the hash it left behind." |
| 0:22.8 | `counterparty / second_8` opened: 8.00, hash, explorer link | "This is the counterparty ceiling: eight dollars to one vendor passes, the next eight is refused per counterparty day, and that refusal opens on the explorer." |
| 0:33.1 | `daily / second_10` opened: 10.00 refused | "The first run also passed a spend it should have refused. The day counter treated nanoseconds as milliseconds, so a day was eighty-six milliseconds, and a twenty-five dollar cap authorised thirty. We fixed it, redeployed, and re-measured." |
| 0:48.1 | the method section, both verifier commands | "The repository re-checks every hash and every figure, and fails when they drift. A policy you can test, not just read. That is the submission." |

Every number in the lines comes from `docs/CLAIMS.md`; the counts are the single run in
`data/spends.json`, not a distribution.

## How to rebuild it

```bash
# 1. narration, one file per segment
uvx edge-tts --voice en-US-AndrewNeural --rate=+3% --text "…" --write-media base-1.mp3

# 2. the audio timeline: 0.4 s lead, 0.6 s between segments, 1.4 s tail
#    (build the concat list from lead/gap/tail silence + base-1..5, then concat)

# 3. the film: the recorder reads the measured segment durations and pins each
#    action to the second its line starts
node tools/record-baseline.mjs https://skyhighdesignsinc-sudo.github.io/baseline-near/

# 4. trim the page-load lead-in the recorder prints as TRIM, then mux
ffmpeg -ss <TRIM> -i baseline-clip.webm -i narration-base.wav \
  -c:v libx264 -crf 22 -pix_fmt yuv420p -r 25 -c:a aac -b:a 128k \
  -movflags +faststart -shortest baseline-matrix.mp4
```

The recorder prints `narration starts at …` and `TRIM …`; both are checked against the
audio, because a film whose sound describes a state the screen has already left is a
recording of nothing.

## What the film does not show

- No console or terminal: there is none to show in this submission.
- No second run: it replays the dataset at run `11873d9d899d`, block 277664211.
- No claim about the pre-fix transaction: it is not on chain under the id we have, so the
  defect is described, not filmed as a hash.
