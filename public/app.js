const loginView = document.querySelector('#loginView');
const appView = document.querySelector('#appView');
const money = value => Number(value || 0).toLocaleString('th-TH', { style: 'currency', currency: 'THB' });

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
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

function showLogin() {
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
}

async function showApp(user) {
  document.querySelector('#welcomeText').textContent = `ยินดีต้อนรับ ${user.name}`;
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  await loadDashboard();
}

async function loadDashboard() {
  const data = await api('/api/dashboard');
  const { metrics } = data;
  document.querySelector('#metrics').innerHTML = [
    ['ยอด Quotation', money(metrics.quotationTotal)],
    ['ยอด PO', money(metrics.poTotal)],
    ['ยอดชำระแล้ว', money(metrics.paidTotal)],
    ['PO รอชำระ', metrics.openPo]
  ].map(([label, value]) => `<div class="metric">${label}<strong>${value}</strong></div>`).join('');

  document.querySelector('#quotationList').innerHTML = data.quotations.map(q => `
    <div class="list-item"><strong>${q.id}</strong> ${q.customerName}<small>${q.projectName} • ${money(q.grandTotal)} • ${new Date(q.createdAt).toLocaleString('th-TH')}</small></div>
  `).join('') || '<p>ยังไม่มีข้อมูล</p>';

  document.querySelector('#poList').innerHTML = data.purchaseOrders.map(po => `
    <div class="list-item"><strong>${po.poNumber || po.id}</strong> ${po.customerName || '-'}<small>${po.projectName || '-'} • ${money(po.totalAmount)} • ${po.status}</small>${po.status !== 'paid' ? `<button data-pay="${po.id}">ยืนยันชำระเงิน / ออกใบเสร็จ PDF</button>` : ''}</div>
  `).join('') || '<p>ยังไม่มีข้อมูล</p>';

  document.querySelector('#receiptList').innerHTML = data.receipts.map(r => `
    <div class="list-item"><strong>${r.id}</strong><small>PO: ${r.poId} • ${money(r.amount)}</small><a href="${r.pdfUrl}" target="_blank">เปิด PDF</a></div>
  `).join('') || '<p>ยังไม่มีข้อมูล</p>';

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
  result.innerHTML = `<strong>สร้าง ${quote.id} สำเร็จ</strong><br>ยอดรวม VAT 7%: ${money(quote.grandTotal)}`;
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
