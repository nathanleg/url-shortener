const code = location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
const messageEl = document.getElementById('message');

async function go() {
  if (!code) {
    location.replace('/');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/lookup/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    location.replace(data.url);
  } catch (e) {
    messageEl.textContent = '';
    messageEl.append('No link found for "', Object.assign(document.createElement('strong'), { textContent: code }), '". ');
    const link = document.createElement('a');
    link.href = '/';
    link.textContent = 'Go home';
    messageEl.append(link);
  }
}

go();
