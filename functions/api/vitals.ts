interface Env {
  VIEWS_KV?: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  };
  DB?: any;
}

interface VitalsReportPayload {
  ttfb?: number;
  fcp?: number;
  lcp?: number;
  cls?: number;
  fid?: number;
  inp?: number;
  lcpElement?: string | null;
  rating?: {
    lcp?: string;
    cls?: string;
    inp?: string;
  };
  path?: string;
  referrer?: string;
}

interface VitalsSummary {
  count: number;
  avgLcp: number;
  avgCls: number;
  avgTtfb: number;
  avgFcp: number;
  ratings: {
    lcp: { good: number; needsImprovement: number; poor: number };
    cls: { good: number; needsImprovement: number; poor: number };
    inp: { good: number; needsImprovement: number; poor: number };
  };
  lastUpdated: string;
}

// 内存单例聚合池（冷启动与未绑定 KV 时的保底）
const memoryVitalsSummary: VitalsSummary = {
  count: 0,
  avgLcp: 0,
  avgCls: 0,
  avgTtfb: 0,
  avgFcp: 0,
  ratings: {
    lcp: { good: 0, needsImprovement: 0, poor: 0 },
    cls: { good: 0, needsImprovement: 0, poor: 0 },
    inp: { good: 0, needsImprovement: 0, poor: 0 },
  },
  lastUpdated: new Date().toISOString(),
};

// 内存内部求和累加器
let memorySumLcp = 0;
let memorySumCls = 0;
let memorySumTtfb = 0;
let memorySumFcp = 0;

// IP 限流滑动窗口
const memoryRateLimitMap = new Map<string, number[]>();

function checkSlidingRateLimit(clientIp: string): boolean {
  const now = Date.now();
  let ts = memoryRateLimitMap.get(clientIp) || [];
  ts = ts.filter(t => now - t < 60000); // 1 分钟窗口

  // 10s 内最多 6 次上报，60s 内最多 25 次
  const recent10s = ts.filter(t => now - t < 10000).length;
  if (recent10s >= 6 || ts.length >= 25) {
    return false;
  }

  ts.push(now);
  if (memoryRateLimitMap.size > 5000) {
    // 内存主动修剪防溢出
    memoryRateLimitMap.clear();
  }
  memoryRateLimitMap.set(clientIp, ts);
  return true;
}

function updateSummaryMetrics(summary: VitalsSummary, payload: VitalsReportPayload) {
  const c = summary.count + 1;
  const lcp = Math.max(0, Math.min(60000, Number(payload.lcp) || 0));
  const cls = Math.max(0, Math.min(10, Number(payload.cls) || 0));
  const ttfb = Math.max(0, Math.min(30000, Number(payload.ttfb) || 0));
  const fcp = Math.max(0, Math.min(30000, Number(payload.fcp) || 0));

  memorySumLcp += lcp;
  memorySumCls += cls;
  memorySumTtfb += ttfb;
  memorySumFcp += fcp;

  summary.count = c;
  summary.avgLcp = Math.round(memorySumLcp / c);
  summary.avgCls = parseFloat((memorySumCls / c).toFixed(4));
  summary.avgTtfb = Math.round(memorySumTtfb / c);
  summary.avgFcp = Math.round(memorySumFcp / c);

  // 评级统计
  const lcpRate = payload.rating?.lcp || (lcp <= 2500 ? 'good' : (lcp <= 4000 ? 'needsImprovement' : 'poor'));
  if (lcpRate === 'good') summary.ratings.lcp.good++;
  else if (lcpRate === 'poor') summary.ratings.lcp.poor++;
  else summary.ratings.lcp.needsImprovement++;

  const clsRate = payload.rating?.cls || (cls <= 0.1 ? 'good' : (cls <= 0.25 ? 'needsImprovement' : 'poor'));
  if (clsRate === 'good') summary.ratings.cls.good++;
  else if (clsRate === 'poor') summary.ratings.cls.poor++;
  else summary.ratings.cls.needsImprovement++;

  const inpVal = Number(payload.inp) || 0;
  const inpRate = payload.rating?.inp || (inpVal <= 200 ? 'good' : (inpVal <= 500 ? 'needsImprovement' : 'poor'));
  if (inpRate === 'good') summary.ratings.inp.good++;
  else if (inpRate === 'poor') summary.ratings.inp.poor++;
  else summary.ratings.inp.needsImprovement++;

  summary.lastUpdated = new Date().toISOString();
}

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { env } = context;
  let currentSummary = memoryVitalsSummary;

  if (env.VIEWS_KV) {
    try {
      const stored = await env.VIEWS_KV.get('vitals:summary');
      if (stored) {
        currentSummary = JSON.parse(stored);
      }
    } catch (e) {}
  }

  return new Response(JSON.stringify({ ok: true, summary: currentSummary }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';

  if (!checkSlidingRateLimit(clientIp)) {
    return new Response(JSON.stringify({ ok: false, error: 'Vitals reporting rate limited' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': '10',
      },
    });
  }

  let payload: VitalsReportPayload;
  try {
    const text = await request.text();
    payload = JSON.parse(text);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // 内存聚合
  updateSummaryMetrics(memoryVitalsSummary, payload);

  // KV 持久化聚合
  if (env.VIEWS_KV) {
    try {
      await env.VIEWS_KV.put('vitals:summary', JSON.stringify(memoryVitalsSummary), { expirationTtl: 86400 * 30 });
    } catch (e) {}
  }

  // D1 关系型审计流水（如果绑定）
  if (env.DB && env.DB.prepare) {
    try {
      const nowTs = Date.now();
      const targetPath = (payload.path || '/').slice(0, 150);
      const metricsSnippet = JSON.stringify({
        lcp: payload.lcp,
        cls: payload.cls,
        ttfb: payload.ttfb,
        fcp: payload.fcp,
        inp: payload.inp
      });
      await env.DB.prepare(
        'INSERT INTO audit_logs (action, target_id, client_ip, status_code, timestamp) VALUES (?, ?, ?, ?, ?)'
      ).bind('vitals_beacon', targetPath, clientIp, 200, nowTs).run();
    } catch (e) {}
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
