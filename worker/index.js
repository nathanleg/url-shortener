import { z } from 'zod';

const ALLOWED_ORIGIN = 'https://theshirtlessdudes.com';

const LoginSchema = z.object({
  password: z.string().min(1),
});

const CreateLinkSchema = z.object({
  url: z.string().url().refine((s) => /^https?:$/.test(new URL(s).protocol), {
    message: 'url must be http or https',
  }),
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'code may only contain letters, numbers, - and _')
    .optional(),
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 6);
}

// Constant-time comparison, hashed first so length differences don't leak via timing.
async function timingSafeStringEqual(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

async function isAuthorized(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || !env.API_KEY) return false;
  return timingSafeStringEqual(match[1], env.API_KEY);
}

const LOGIN_ATTEMPT_LIMIT = 20;

// Caps total login attempts per day so a guessed password can't be brute-forced online.
async function checkLoginAttempts(env) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `loginattempts:${day}`;
  const count = parseInt((await env.LINKS.get(key)) || '0', 10);
  if (count >= LOGIN_ATTEMPT_LIMIT) return false;

  await env.LINKS.put(key, String(count + 1), { expirationTtl: 172800 });
  return true;
}

const DAILY_LIMIT = 10;

// Approximate cap on API key usage: KV is eventually consistent, so concurrent
// requests could rarely nudge the count a bit past DAILY_LIMIT, but that's fine
// for throttling a single personal key rather than enforcing a hard security bound.
async function checkRateLimit(env) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `ratelimit:${day}`;
  const count = parseInt((await env.LINKS.get(key)) || '0', 10);
  if (count >= DAILY_LIMIT) return false;

  await env.LINKS.put(key, String(count + 1), { expirationTtl: 172800 });
  return true;
}

// Requires a valid API key; returns an error Response to short-circuit the
// request, or null when the call may proceed.
async function requireAuth(request, env) {
  if (!(await isAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);
  return null;
}

// Same as requireAuth, but also enforces the daily cap on state-changing calls
// (create/delete) so viewing the list on every page load doesn't burn quota.
async function authorize(request, env) {
  const authError = await requireAuth(request, env);
  if (authError) return authError;
  if (!(await checkRateLimit(env))) {
    return json({ error: `Limited to ${DAILY_LIMIT} link changes per day` }, 429);
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // POST /login - exchange the site password for the session token
    if (pathname === '/login' && request.method === 'POST') {
      if (!(await checkLoginAttempts(env))) {
        return json({ error: 'too many login attempts today, try again tomorrow' }, 429);
      }

      const body = await request.json().catch(() => null);
      const parsed = LoginSchema.safeParse(body);
      if (!parsed.success) return json({ error: 'password is required' }, 400);

      if (!env.SITE_PASSWORD || !(await timingSafeStringEqual(parsed.data.password, env.SITE_PASSWORD))) {
        return json({ error: 'incorrect password' }, 401);
      }

      return json({ token: env.API_KEY });
    }

    // GET /links - list all links (owner only, not rate-limited since it's just a read)
    if (pathname === '/links' && request.method === 'GET') {
      const authError = await requireAuth(request, env);
      if (authError) return authError;

      const list = await env.LINKS.list({ prefix: 'link:' });
      const links = [];
      for (const key of list.keys) {
        const value = await env.LINKS.get(key.name, 'json');
        if (value) links.push({ code: key.name.slice('link:'.length), ...value });
      }
      links.sort((a, b) => b.createdAt - a.createdAt);
      return json(links);
    }

    // POST /links - create a link (owner only)
    if (pathname === '/links' && request.method === 'POST') {
      const authError = await authorize(request, env);
      if (authError) return authError;

      const body = await request.json().catch(() => null);
      const parsed = CreateLinkSchema.safeParse(body);
      if (!parsed.success) {
        return json({ error: parsed.error.issues[0]?.message || 'invalid request body' }, 400);
      }

      const { url: targetUrl, code: customCode } = parsed.data;
      let code = customCode || makeCode();

      if (customCode) {
        const existing = await env.LINKS.get(`link:${code}`);
        if (existing) return json({ error: 'that code is already taken' }, 409);
      } else {
        while (await env.LINKS.get(`link:${code}`)) {
          code = makeCode();
        }
      }

      const entry = { url: targetUrl, createdAt: Date.now(), clicks: 0 };
      await env.LINKS.put(`link:${code}`, JSON.stringify(entry));
      return json({ code, ...entry }, 201);
    }

    // DELETE /links/:code (owner only)
    if (pathname.startsWith('/links/') && request.method === 'DELETE') {
      const authError = await authorize(request, env);
      if (authError) return authError;

      const code = pathname.slice('/links/'.length);
      const existing = await env.LINKS.get(`link:${code}`);
      if (!existing) return json({ error: 'not found' }, 404);

      await env.LINKS.delete(`link:${code}`);
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET /lookup/:code - public, used by 404.html to resolve a short code for anyone
    if (pathname.startsWith('/lookup/') && request.method === 'GET') {
      const code = pathname.slice('/lookup/'.length);
      const entry = await env.LINKS.get(`link:${code}`, 'json');
      if (!entry) return json({ error: 'not found' }, 404);

      entry.clicks += 1;
      await env.LINKS.put(`link:${code}`, JSON.stringify(entry));
      return json({ url: entry.url });
    }

    return json({ error: 'not found' }, 404);
  },
};
