const loginGate = document.getElementById('login-gate');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password-input');
const loginError = document.getElementById('login-error');
const app = document.getElementById('app');

const list = document.getElementById('link-list');
const form = document.getElementById('add-form');
const urlInput = document.getElementById('url-input');
const codeInput = document.getElementById('code-input');
const errorEl = document.getElementById('error');
const setupNotice = document.getElementById('setup-notice');

if (!API_BASE || API_BASE.includes('YOUR-SUBDOMAIN')) {
  setupNotice.hidden = false;
}

function getToken() {
  return localStorage.getItem('shortener_token');
}

function setToken(token) {
  localStorage.setItem('shortener_token', token);
}

function clearToken() {
  localStorage.removeItem('shortener_token');
}

function showApp() {
  loginGate.hidden = true;
  app.hidden = false;
  loadLinks();
}

function showLoginGate(message) {
  clearToken();
  app.hidden = true;
  loginGate.hidden = false;
  loginError.textContent = message || '';
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    const data = await res.json();

    if (!res.ok) {
      loginError.textContent = data.error || 'Something went wrong';
      return;
    }

    setToken(data.token);
    passwordInput.value = '';
    showApp();
  } catch (e) {
    loginError.textContent = 'Could not reach the API backend.';
  }
});

async function loadLinks() {
  try {
    const res = await fetch(`${API_BASE}/links`, { headers: authHeaders() });
    if (res.status === 401) return showLoginGate('Session expired, please log in again.');
    const links = await res.json();
    render(links);
  } catch (e) {
    list.innerHTML = '<li class="empty">Could not reach the API backend.</li>';
  }
}

function render(links) {
  list.innerHTML = '';
  if (links.length === 0) {
    list.innerHTML = '<li class="empty">No links yet</li>';
    return;
  }
  for (const link of links) {
    const li = document.createElement('li');
    const shortUrl = `https://theshirtlessdudes.com/${link.code}`;

    const top = document.createElement('div');
    top.className = 'top';

    const a = document.createElement('a');
    a.className = 'short';
    a.href = shortUrl;
    a.target = '_blank';
    a.textContent = shortUrl.replace(/^https?:\/\//, '');

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(shortUrl);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
    });

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = '×';
    del.addEventListener('click', () => deleteLink(link.code));

    top.append(a, copyBtn, del);

    const target = document.createElement('div');
    target.className = 'target';
    target.textContent = link.url;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${link.clicks} click${link.clicks === 1 ? '' : 's'} · ${new Date(link.createdAt).toLocaleString()}`;

    li.append(top, target, meta);
    list.appendChild(li);
  }
}

async function deleteLink(code) {
  const res = await fetch(`${API_BASE}/links/${code}`, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) return showLoginGate('Session expired, please log in again.');
  loadLinks();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const url = urlInput.value.trim();
  const code = codeInput.value.trim();

  try {
    const res = await fetch(`${API_BASE}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ url, code: code || undefined })
    });

    if (res.status === 401) return showLoginGate('Session expired, please log in again.');

    if (!res.ok) {
      const data = await res.json();
      errorEl.textContent = data.error || 'Something went wrong';
      return;
    }
  } catch (e) {
    errorEl.textContent = 'Could not reach the API backend.';
    return;
  }

  urlInput.value = '';
  codeInput.value = '';
  loadLinks();
});

if (getToken()) {
  showApp();
}
