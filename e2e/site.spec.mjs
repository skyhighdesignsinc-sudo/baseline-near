// e2e/site.spec.mjs — the public judge view, executed rather than eyeballed.
//
// Every number asserted here is one the dataset also states, so the page and
// data/spends.json cannot drift apart without this failing. Nothing is mocked:
// the page fetches the JSON file the repository ships.
import { expect, test } from '@playwright/test';

const ROWS = 24;
const AUTHORISED = 8;
const REFUSED = 16;
const CODES = 17;

test.describe('baseline judge view', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('#rows tr')).toHaveCount(ROWS);
  });

  test('renders the counts the dataset states', async ({ page }) => {
    await expect(page).toHaveTitle(/Baseline/);
    await expect(page.locator('#s-attempts')).toHaveText(String(ROWS));
    await expect(page.locator('#s-auth')).toHaveText(String(AUTHORISED));
    await expect(page.locator('#s-refused')).toHaveText(String(REFUSED));
    await expect(page.locator('#s-codes')).toContainText(`${CODES} distinct codes`);
    await expect(page.locator('#s-verified')).toHaveText(`${ROWS}/${ROWS}`);
    await expect(page.locator('#s-block')).toContainText(/block \d+/);
    await expect(page.locator('#rowcount')).toContainText(`Showing ${ROWS} of ${ROWS} attempts`);
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('filters by outcome without miscounting', async ({ page }) => {
    await page.getByRole('button', { name: /^refused/i }).click();
    await expect(page.locator('#rows tr')).toHaveCount(REFUSED);
    await expect(page.locator('#rowcount')).toContainText(`Showing ${REFUSED} of ${ROWS}`);

    await page.getByRole('button', { name: /^authorised/i }).click();
    await expect(page.locator('#rows tr')).toHaveCount(AUTHORISED);

    await page.getByRole('button', { name: /^all/i }).click();
    await expect(page.locator('#rows tr')).toHaveCount(ROWS);
  });

  test('search narrows to the rows that match', async ({ page }) => {
    await page.locator('#search').fill('per_day_exceeded');
    const count = await page.locator('#rows tr').count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(ROWS);
    const codes = await page.locator('#rows tr td.observed').allInnerTexts();
    for (const code of codes) expect(code).toBe('per_day_exceeded');
    await page.locator('#search').fill('');
    await expect(page.locator('#rows tr')).toHaveCount(ROWS);
  });

  test('a row opens the transaction it left behind', async ({ page }) => {
    await expect(page.locator('#detail')).toBeHidden();
    await page
      .locator('#rows tr', { hasText: 'per_counterparty_day_exceeded' })
      .first()
      .click();

    const detail = page.locator('#detail');
    await expect(detail).toBeVisible();
    await expect(page.locator('#d-title')).toContainText('counterparty');

    const hash = (await page.locator('#d-hash').innerText()).trim();
    expect(hash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);

    const href = await page.locator('#d-link').getAttribute('href');
    expect(href).toContain('testnet.nearblocks.io/txns/');
    expect(href).toContain(hash);
    await expect(page.locator('#d-link')).toHaveAttribute('target', '_blank');
  });

  test('the coverage list names every code observed in the run', async ({ page }) => {
    const codes = page.locator('#codes li');
    await expect(codes).toHaveCount(CODES);
    await expect(page.locator('#codes li.ok')).toHaveText('authorised');
  });

  test('amounts are rendered at the asset scale, not a tenth of it', async ({ page }) => {
    // The dataset stores 20,000,000 for a 20 USDC spend (6 decimals). A row that
    // says 2.00 is describing a different transaction from the one on chain.
    const row = page.locator('#rows tr', { hasText: 'per_day_exceeded' }).first();
    await expect(row.locator('td.amt')).toHaveText('10.00');
    await row.click();
    await expect(page.locator('#d-amount')).toHaveText('10.00 USDC');

    const overCap = page.locator('#rows tr', { hasText: 'per_tx_exceeded' }).first();
    await expect(overCap.locator('td.amt')).toHaveText('40.00');
  });

  test('the machine surface is fetchable and agrees with the page', async ({ request }) => {
    const map = await request.get('/llms.txt');
    expect(map.status()).toBe(200);
    const body = await map.text();
    expect(body).toContain('/data/spends.json');
    expect(body).toContain(`run: 11873d9d899d`);

    const summary = await request.get('/api/summary.json');
    expect(summary.status()).toBe(200);
    const json = await summary.json();
    expect(json.counts).toMatchObject({
      attempts: ROWS,
      authorised: AUTHORISED,
      refused: REFUSED,
      distinctCodes: CODES,
    });
    expect(json.codes).toHaveLength(CODES);
  });

  test('the method section names the verifier a reader can run', async ({ page }) => {
    await expect(page.locator('#method')).toContainText('check-evidence.mjs');
    await expect(page.locator('#method')).toContainText('e2e.mjs');
    await expect(page.locator('#runline')).toContainText(/^run \S+ · block \d+/);
  });
});
