const ALLOWED_ORIGIN = 'https://theshirtlessdudes.com';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 6);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // GET /links - list all links
    if (pathname === '/links' && request.method === 'GET') {
      const list = await env.LINKS.list();
      const links = [];
      for (const key of list.keys) {
        const value = await env.LINKS.get(key.name, 'json');
        if (value) links.push({ code: key.name, ...value });
      }
      links.sort((a, b) => b.createdAt - a.createdAt);
      return json(links);
    }

    // POST /links - create a link
    if (pathname === '/links' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { url: targetUrl, code: customCode } = body;

      if (!targetUrl || !isValidUrl(targetUrl)) {
        return json({ error: 'a valid http(s) url is required' }, 400);
      }

      let code = customCode ? customCode.trim() : makeCode();

      if (customCode) {
        const existing = await env.LINKS.get(code);
        if (existing) return json({ error: 'that code is already taken' }, 409);
      } else {
        while (await env.LINKS.get(code)) {
          code = makeCode();
        }
      }

      const entry = { url: targetUrl, createdAt: Date.now(), clicks: 0 };
      await env.LINKS.put(code, JSON.stringify(entry));
      return json({ code, ...entry }, 201);
    }

    // DELETE /links/:code
    if (pathname.startsWith('/links/') && request.method === 'DELETE') {
      const code = pathname.slice('/links/'.length);
      const existing = await env.LINKS.get(code);
      if (!existing) return json({ error: 'not found' }, 404);

      await env.LINKS.delete(code);
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET /lookup/:code - used by 404.html to resolve a short code
    if (pathname.startsWith('/lookup/') && request.method === 'GET') {
      const code = pathname.slice('/lookup/'.length);
      const entry = await env.LINKS.get(code, 'json');
      if (!entry) return json({ error: 'not found' }, 404);

      entry.clicks += 1;
      await env.LINKS.put(code, JSON.stringify(entry));
      return json({ url: entry.url });
    }

    return json({ error: 'not found' }, 404);
  },
};
