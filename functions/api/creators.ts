import type { Env } from '../_env';

const memoryClicksStore = new Map<string, number>();
const memoryRateLimitMap = new Map<string, number[]>();

function getClientIp(context: EventContext<Env, any, any>): string {
  return (
    context.request.headers.get('cf-connecting-ip') ||
    context.request.headers.get('x-forwarded-for') ||
    '127.0.0.1'
  ).split(',')[0].trim();
}

function checkRateLimit(clientIp: string, now = Date.now()): boolean {
  const timestamps = memoryRateLimitMap.get(clientIp) || [];
  const activeTimestamps = timestamps.filter(t => now - t < 60000);
  if (activeTimestamps.length >= 60) {
    return false;
  }
  activeTimestamps.push(now);
  memoryRateLimitMap.set(clientIp, activeTimestamps);
  return true;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const isBatch = url.searchParams.get('batch') === '1';
  const screenName = url.searchParams.get('screen_name');

  if (isBatch) {
    const result: Record<string, number> = {};
    for (const [key, val] of memoryClicksStore.entries()) {
      result[key] = val;
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120'
      }
    });
  }

  if (screenName) {
    const cleanName = screenName.toLowerCase().replace(/^@+/, '');
    const kvKey = `creator:clicks:${cleanName}`;
    let clicks = memoryClicksStore.get(cleanName) || 0;

    if (context.env.VIEWS_KV) {
      try {
        const stored = await context.env.VIEWS_KV.get(kvKey);
        if (stored) {
          const parsed = parseInt(stored, 10);
          if (!isNaN(parsed)) clicks = Math.max(clicks, parsed);
        }
      } catch (err) {
        console.error('KV get error in creators.ts:', err);
      }
    }

    return new Response(JSON.stringify({ screen_name: cleanName, clicks }), {
      status: 200,
      headers: CORS_HEADERS
    });
  }

  return new Response(JSON.stringify({ error: 'Missing screen_name or batch parameter' }), {
    status: 400,
    headers: CORS_HEADERS
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const clientIp = getClientIp(context);
  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
      status: 429,
      headers: {
        ...CORS_HEADERS,
        'Retry-After': '60'
      }
    });
  }

  let screenName = '';
  let source = 'card';

  try {
    const body = await context.request.json() as any;
    screenName = body?.screen_name || '';
    source = body?.source || 'card';
  } catch {
    const url = new URL(context.request.url);
    screenName = url.searchParams.get('screen_name') || '';
    source = url.searchParams.get('source') || 'card';
  }

  const cleanName = screenName.toLowerCase().replace(/^@+/, '').trim();
  if (!cleanName) {
    return new Response(JSON.stringify({ error: 'Invalid or missing screen_name' }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }

  const kvKey = `creator:clicks:${cleanName}`;
  let currentClicks = memoryClicksStore.get(cleanName) || 0;

  if (context.env.VIEWS_KV) {
    try {
      const stored = await context.env.VIEWS_KV.get(kvKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) currentClicks = Math.max(currentClicks, parsed);
      }
    } catch (err) {
      console.error('KV get error before increment:', err);
    }
  }

  const newClicks = currentClicks + 1;
  memoryClicksStore.set(cleanName, newClicks);

  if (context.env.VIEWS_KV) {
    try {
      await context.env.VIEWS_KV.put(kvKey, String(newClicks));
    } catch (err) {
      console.error('KV put error in creators.ts:', err);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      screen_name: cleanName,
      total_clicks: newClicks,
      source
    }),
    {
      status: 200,
      headers: CORS_HEADERS
    }
  );
};
