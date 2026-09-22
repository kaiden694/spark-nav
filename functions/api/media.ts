import type { Env } from '../_env';

const CREATOR_GRADIENTS = [
  { start: '#ff5858', end: '#f09819' },
  { start: '#654ea3', end: '#eaafc8' },
  { start: '#00c6ff', end: '#0072ff' },
  { start: '#11998e', end: '#38ef7d' },
  { start: '#ff758c', end: '#ff7eb3' },
  { start: '#8e2de2', end: '#4a00e0' },
  { start: '#f857a6', end: '#ff5858' },
  { start: '#4facfe', end: '#00f2fe' },
  { start: '#f12711', end: '#f5af19' },
  { start: '#b224ef', end: '#7579ff' },
  { start: '#13547a', end: '#80d0c7' },
  { start: '#ff0844', end: '#ffb199' }
];

function generateCreatorAvatarSvg(identifier: string): string {
  let cleanId = (identifier || '')
    .replace(/^avatars%2F|^avatars\//i, '')
    .replace(/\.[a-zA-Z0-9]+$/g, '')
    .replace(/(_400x400|_normal|_bigger|_mini)$/g, '')
    .trim();
  if (!cleanId) cleanId = 'SparkNav';

  let hash = 0;
  for (let i = 0; i < cleanId.length; i++) {
    hash = (hash << 5) - hash + cleanId.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash);
  const theme = CREATOR_GRADIENTS[seed % CREATOR_GRADIENTS.length];
  const gradId = `cf_grad_${seed % CREATOR_GRADIENTS.length}`;

  const candidateText = cleanId.replace(/[@#\$%^&*\(\)_+\-=\[\]{};':"\\|,.<>\/?]/g, ' ').trim();
  let initials = '';
  if (/[\u4e00-\u9fa5]/.test(candidateText)) {
    const match = candidateText.match(/[\u4e00-\u9fa5]+/);
    if (match) initials = match[0].slice(0, 2);
  }
  if (!initials) {
    const words = candidateText.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      initials = (words[0][0] + words[1][0]).toUpperCase();
    } else {
      const uppers = candidateText.match(/[A-Z]/g);
      if (uppers && uppers.length >= 2) {
        initials = uppers.slice(0, 2).join('');
      } else {
        initials = candidateText.slice(0, 2).toUpperCase();
      }
    }
  }
  if (!initials) initials = 'S';
  const hairStyle = seed % 3;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${theme.start}"/>
      <stop offset="100%" stop-color="${theme.end}"/>
    </linearGradient>
    <clipPath id="circle_clip_${seed}">
      <circle cx="50" cy="50" r="50"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle_clip_${seed})">
    <rect width="100" height="100" fill="url(#${gradId})"/>
    <circle cx="20" cy="15" r="25" fill="#ffffff" opacity="0.15"/>
    <circle cx="85" cy="80" r="30" fill="#000000" opacity="0.1"/>
    <path d="M22 92 C22 75 35 68 50 68 C65 68 78 75 78 92 Z" fill="#ffffff" opacity="0.88"/>
    <ellipse cx="50" cy="46" rx="19" ry="21" fill="#ffffff" opacity="0.95"/>
    ${hairStyle === 0 ? `
      <path d="M30 46 C28 26 72 26 70 46 C68 58 74 72 73 82 C68 78 66 65 66 56 C64 40 36 40 34 56 C34 65 32 78 27 82 C26 72 32 58 30 46 Z" fill="${theme.start}" opacity="0.4"/>
    ` : hairStyle === 1 ? `
      <circle cx="34" cy="30" r="10" fill="${theme.start}" opacity="0.35"/>
      <path d="M32 44 C30 28 70 28 68 44 C65 40 60 33 50 33 C40 33 35 40 32 44 Z" fill="${theme.start}" opacity="0.4"/>
    ` : `
      <path d="M31 42 C30 25 70 25 69 42 C67 52 69 64 65 72 C63 60 63 46 50 46 C37 46 37 60 35 72 C31 64 33 52 31 42 Z" fill="${theme.start}" opacity="0.4"/>
    `}
    <path d="M78 22 Q78 28 84 28 Q78 28 78 34 Q78 28 72 28 Q78 28 78 22 Z" fill="#ffffff" opacity="0.8"/>
    <circle cx="24" cy="36" r="2.5" fill="#ffffff" opacity="0.75"/>
    <rect x="25" y="74" width="50" height="20" rx="10" fill="#ffffff" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"/>
    <text x="50" y="88" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="800" fill="${theme.end}" letter-spacing="0.5">${initials}</text>
  </g>
</svg>`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const key = url.searchParams.get('key');
  const targetUrl = url.searchParams.get('url');

  let remoteUrl = '';
  const upstreamBase = (context.env as any).MEDIA_PROXY_UPSTREAM || '';

  if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    remoteUrl = targetUrl;
  } else if (key && upstreamBase) {
    const cleanKey = decodeURIComponent(key).replace(/^\/+/, '');
    remoteUrl = `${upstreamBase.replace(/\/+$/, '')}/${cleanKey}`;
  }

  const fallbackIdentifier = key || targetUrl || 'Creator';

  if (remoteUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);

      const upstreamRes = await fetch(remoteUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': ''
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      const contentType = upstreamRes.headers.get('content-type') || '';
      if (upstreamRes.ok && contentType.startsWith('image/')) {
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', contentType);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400');

        return new Response(upstreamRes.body, {
          status: 200,
          headers: responseHeaders
        });
      }
    } catch (err: any) {
      // Fallback to dynamic SVG
    }
  }

  // Pure SVG Dynamic Fallback Avatar
  return new Response(generateCreatorAvatarSvg(fallbackIdentifier), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
};
