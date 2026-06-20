const loginView = document.querySelector('#loginView');
const appView = document.querySelector('#appView');
const money = value => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'THB' });

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function addQuoteItem() {
  const node = document.querySelector('#itemTemplate').content.cloneNode(true);
  node.querySelector('button').addEventListener('click', event => event.target.closest('.quote-row').remove());
  document.querySelector('#quoteItems').appendChild(node);
}

async function boot() {
  addQuoteItem();
  const me = await api('/api/me');
  if (me.user) showApp(me.user); else showLogin();
}

function restartAnimations(root) {
  root.querySelectorAll('.reveal, .metric, .list-item, .quote-row').forEach(element => {
    element.style.animation = 'none';
    element.offsetHeight;
    element.style.animation = '';
  });
}

function showLogin() {
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
  restartAnimations(loginView);
}

async function showApp(user) {
  document.querySelector('#welcomeText').textContent = `Welcome, ${user.name}`;
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  restartAnimations(appView);
  await loadDashboard();
}

function formatStatus(status) {
  return String(status || '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

async function loadDashboard() {
  const data = await api('/api/dashboard');
  const { metrics } = data;
  document.querySelector('#metrics').innerHTML = [
    ['Quotation total', money(metrics.quotationTotal)],
    ['PO total', money(metrics.poTotal)],
    ['Paid total', money(metrics.paidTotal)],
    ['Open POs', metrics.openPo]
  ].map(([label, value], index) => `<div class="metric" style="animation-delay: ${index * 70}ms">${label}<strong>${value}</strong></div>`).join('');

  document.querySelector('#quotationList').innerHTML = data.quotations.map((q, index) => `
    <div class="list-item" style="animation-delay: ${index * 45}ms"><strong>${q.id}</strong> ${q.customerName}<small>${q.projectName} • ${money(q.grandTotal)} • ${new Date(q.createdAt).toLocaleString('en-US')}</small></div>
  `).join('') || '<p>No records yet</p>';

  document.querySelector('#poList').innerHTML = data.purchaseOrders.map((po, index) => `
    <div class="list-item" style="animation-delay: ${index * 45}ms"><strong>${po.poNumber || po.id}</strong> ${po.customerName || '-'}<small>${po.projectName || '-'} • ${money(po.totalAmount)} • ${formatStatus(po.status)}</small>${po.status !== 'paid' ? `<button data-pay="${po.id}">Confirm payment / Generate receipt PDF</button>` : ''}</div>
  `).join('') || '<p>No records yet</p>';

  document.querySelector('#receiptList').innerHTML = data.receipts.map((r, index) => `
    <div class="list-item" style="animation-delay: ${index * 45}ms"><strong>${r.id}</strong><small>PO: ${r.poId} • ${money(r.amount)}</small><a href="${r.pdfUrl}" target="_blank">Open PDF</a></div>
  `).join('') || '<p>No records yet</p>';

  document.querySelectorAll('[data-pay]').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/purchase-orders/${button.dataset.pay}/pay`, { method: 'POST', body: '{}' });
      await loadDashboard();
    });
  });
}

document.querySelector('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    await showApp(data.user);
  } catch (error) { alert(error.message); }
});

document.querySelector('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  showLogin();
});

document.querySelector('#addItemBtn').addEventListener('click', addQuoteItem);

document.querySelector('#quotationForm').addEventListener('submit', async event => {
  event.preventDefault();
  const rows = [...document.querySelectorAll('.quote-row')];
  const items = rows.map(row => ({
    name: row.querySelector('[name="name"]').value,
    quantity: row.querySelector('[name="quantity"]').value,
    price: row.querySelector('[name="price"]').value
  }));
  const payload = { customerName: event.target.customerName.value, projectName: event.target.projectName.value, items };
  const quote = await api('/api/quotations', { method: 'POST', body: JSON.stringify(payload) });
  const result = document.querySelector('#quotationResult');
  result.style.display = 'block';
  result.innerHTML = `<strong>${quote.id} created successfully</strong><br>Total including 7% VAT: ${money(quote.grandTotal)}`;
  event.target.reset();
  document.querySelector('#quoteItems').innerHTML = '';
  addQuoteItem();
  await loadDashboard();
});

document.querySelector('#poForm').addEventListener('submit', async event => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target));
  await api('/api/purchase-orders', { method: 'POST', body: JSON.stringify(payload) });
  event.target.reset();
  await loadDashboard();
});

boot().catch(error => alert(error.message));
