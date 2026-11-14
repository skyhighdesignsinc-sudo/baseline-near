// The page renders `data/spends.json` exactly as the experiment wrote it. Nothing
// here computes an outcome: the codes on screen are the codes the contract returned.
const state = { all: [], filter: 'all', query: '' };

const $ = (id) => document.getElementById(id);
// USDC on this contract has 6 decimals, the same convention the dataset and
// docs/FINDINGS.md use (20,000,000 = 20 USDC). Dividing by 1e7 here made every
// amount on the page a tenth of the transaction it describes.
const usdc = (raw) => {
  const n = Number(raw ?? 0) / 1e6;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function badge(row) {
  return row.got === 'authorised' ? 'AUTHORISED' : 'REFUSED';
}

function apply() {
  const q = state.query.trim().toLowerCase();
  const rows = state.all.filter((row) => {
    if (state.filter === 'authorised' && row.got !== 'authorised') return false;
    if (state.filter === 'refused' && row.got === 'authorised') return false;
    if (!q) return true;
    return `${row.shape} ${row.case} ${row.got} ${row.expected} ${usdc(row.amount)}`.toLowerCase().includes(q);
  });

  const body = $('rows');
  body.textContent = '';
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.className = row.got === 'authorised' ? 'authorised' : 'refused';
    if (row.matched === false) tr.classList.add('mismatch');
    tr.innerHTML = `
      <td class="num">${String(i + 1).padStart(2, '0')}</td>
      <td>${row.shape}</td>
      <td>${row.case}</td>
      <td class="expected">${row.expected}</td>
      <td class="observed">${row.got}</td>
      <td class="amt">${usdc(row.amount)}</td>
      <td class="res">${badge(row)}</td>`;
    tr.addEventListener('click', () => select(row, tr));
    body.appendChild(tr);
  });
  $('rowcount').textContent = `Showing ${rows.length} of ${state.all.length} attempts. ${
    rows.length ? 'A row opens the transaction it left behind.' : 'No row matches that filter.'
  }`;
}

function select(row, tr) {
  document.querySelectorAll('#rows tr.sel').forEach((el) => el.classList.remove('sel'));
  tr.classList.add('sel');
  $('detail').hidden = false;
  $('d-title').textContent = `${row.shape} / ${row.case}`;
  $('d-sub').textContent =
    row.matched === false
      ? 'Observed result differs from the recorded expectation.'
      : `Recorded outcome matches the expectation (${row.expected}).`;
  $('d-hash').textContent = row.tx ?? '—';
  $('d-mandate').textContent = row.mandate ?? '—';
  $('d-amount').textContent = row.amount ? `${usdc(row.amount)} USDC` : '—';
  $('d-vendor').textContent = row.vendor ?? '—';
  const link = $('d-link');
  link.href = row.explorer ?? `https://testnet.nearblocks.io/txns/${row.tx}`;
}

function render(data) {
  state.all = data.rows ?? [];
  const refused = state.all.filter((r) => r.got !== 'authorised').length;
  const authorised = state.all.length - refused;
  const codes = [...new Set(state.all.map((r) => r.got))];

  $('s-attempts').textContent = state.all.length;
  $('s-auth').textContent = authorised;
  $('s-refused').textContent = refused;
  $('s-codes').textContent = `${codes.length} distinct codes`;
  $('s-verified').textContent = `${state.all.filter((r) => r.tx).length}/${state.all.length}`;
  $('s-block').textContent = `block ${data.blockHeight ?? '—'}`;
  $('c-all').textContent = state.all.length;
  $('c-auth').textContent = authorised;
  $('c-refused').textContent = refused;

  $('ctx-account').textContent = `account ${data.account ?? '—'}`;
  $('foot-account').textContent = data.explorer ?? '';
  $('runline').textContent = `run ${data.run ?? '—'} · block ${data.blockHeight ?? '—'} · ${
    data.startedAt ?? ''
  }`;

  const list = $('codes');
  list.textContent = '';
  codes
    .sort((a, b) => (a === 'authorised' ? -1 : b === 'authorised' ? 1 : a.localeCompare(b)))
    .forEach((code) => {
      const li = document.createElement('li');
      li.textContent = code;
      if (code === 'authorised') li.classList.add('ok');
      list.appendChild(li);
    });

  apply();
}

$('filters').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b === button));
  apply();
});

$('search').addEventListener('input', (event) => {
  state.query = event.target.value;
  apply();
});

fetch('./data/spends.json', { cache: 'no-store' })
  .then((res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  })
  .then(render)
  .catch((err) => {
    $('rowcount').textContent = `The dataset did not load: ${err.message}`;
  });
