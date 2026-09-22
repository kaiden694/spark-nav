/**
 * XIU Navigation - LLM Summarizer Engine
 * Generates concise, professional, geek-curated Chinese one-sentence descriptions (35-55 chars)
 * for submitted websites.
 *
 * Supported Providers (auto-detected in priority order):
 * 1. Google Gemini API (GEMINI_API_KEY or GOOGLE_API_KEY)
 * 2. OpenAI-compatible API (LLM_API_KEY, LLM_API_BASE, LLM_MODEL)
 * 3. Local Ollama (OLLAMA_HOST / OLLAMA_BASE_URL, OLLAMA_MODEL)
 * 4. Defensive Fallback: returns raw/heuristic description on any error or timeout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapTgnavCategory } from './import-tgnav-sources.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// Automatically load .env if present in project root
if (typeof process.loadEnvFile === 'function') {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch (e) {}
  }
}

const PROMPT_SYSTEM = `你是一个极客技术导航站的高级资深编辑兼开源技术专家。你的职责是为收录的站点或开源项目编写一句精炼、专业、高质感的中文推荐概括。
核心要求：
1. 字数严格控制在 35-55 字之间，以中文句号结尾；
2. 语言极客专业，突出站点的核心用途（究竟是干什么用的、核心功能）、技术特色与解决的核心痛点；
3. 若原始信息为英文或 GitHub 开源项目，必须结合其技术栈与使用场景翻译提炼，明确说明核心用途与替代对象（例如“轻量级 YouTube 替代前端”、“现代代理客户端”等），严禁空谈“高星项目”或输出“官方平台与实用网络资源”等无意义套话；
4. 严禁使用“非常好用”、“值得一试”、“赶紧收藏”等空洞煽动性套话；
5. 直接输出这一句中文概括文本，绝对不要包含任何前缀、解释、Markdown 符号或额外标点说明。`;

function buildUserPrompt({
  title = '',
  url = '',
  rawDescription = '',
  htmlSnippet = '',
  language = '',
  topics = [],
  stars = 0,
  category = ''
}) {
  let prompt = `【目标站点/开源项目信息】\n• 名称：${title || '未命名站点'}\n• 网址：${url}\n`;
  if (category) {
    prompt += `• 归属类型：${category === 'github' ? 'GitHub 开源项目' : category}\n`;
  }
  if (language) {
    prompt += `• 编程语言：${language}\n`;
  }
  if (stars) {
    prompt += `• 关注星标：★${stars}\n`;
  }
  if (Array.isArray(topics) && topics.length > 0) {
    prompt += `• 核心标签 (Topics)：${topics.join(', ')}\n`;
  }
  if (rawDescription) {
    prompt += `• 原始简介：${rawDescription.slice(0, 400)}\n`;
  }
  if (htmlSnippet) {
    prompt += `• 网页文本摘录：${htmlSnippet.slice(0, 500)}\n`;
  }
  prompt += `\n请根据以上信息提炼输出一句 35-55 字的极客推荐概括，必须说明它是干什么用的、核心用途与解决痛点：`;
  return prompt;
}

/**
 * Clean and truncate LLM output to ensure strict format compliance
 */
function cleanSummary(rawText, allowEnglish = false) {
  if (!rawText || typeof rawText !== 'string') return '';
  let cleaned = rawText
    .replace(/^["'“‘`]+|["'”’`]+$/g, '')
    .replace(/^[，,。.、\s\-_:：]+/, '')
    .replace(/^(推荐理由|概括描述|站点简介|核心特色|项目介绍|项目简介|简介)[：:]\s*/i, '')
    .trim();

  // If text doesn't end with sentence-ending punctuation, append period
  if (cleaned && !/[。！？!?.]$/.test(cleaned)) {
    cleaned += '。';
  }

  // Reject obvious junk
  if (cleaned.length < 5) {
    return '';
  }

  // Reject non-Chinese text unless allowEnglish is explicitly enabled (e.g. for fallback preserve)
  if (!allowEnglish && !/[\u4e00-\u9fa5]/.test(cleaned)) {
    return '';
  }

  return cleaned;
}

/**
 * 1. Call Gemini API
 */
async function callGemini(apiKey, userPrompt, timeoutMs = 8000) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    systemInstruction: { parts: [{ text: PROMPT_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  let res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });

  // Fallback retry without thinkingConfig if rejected by older/specific model
  if (!res.ok && res.status === 400) {
    delete payload.generationConfig.thinkingConfig;
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  }

  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return cleanSummary(text);
}

/**
 * 2. Call OpenAI-compatible API
 */
async function callOpenAICompatible(apiKey, apiBase, model, userPrompt, timeoutMs = 9000) {
  const normalizedBase = (apiBase || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const endpoint = `${normalizedBase}/chat/completions`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PROMPT_SYSTEM },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 128
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    throw new Error(`OpenAI-compatible HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return cleanSummary(text);
}

/**
 * 3. Call Local Ollama
 */
async function callOllama(host, model, userPrompt, timeoutMs = 5000) {
  const normalizedHost = (host || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const endpoint = `${normalizedHost}/api/generate`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'qwen2.5:7b',
      system: PROMPT_SYSTEM,
      prompt: userPrompt,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 128
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}`);
  }

  const data = await res.json();
  return cleanSummary(data?.response);
}

/**
 * Main entrance: summarize with multi-provider detection and automatic fallback
 */
export async function summarizeWithLLM({
  title,
  url,
  rawDescription,
  htmlSnippet = '',
  language = '',
  topics = [],
  stars = 0,
  category = ''
}, options = {}) {
  const timeoutMs = options.timeoutMs || 9000;
  const userPrompt = buildUserPrompt({
    title,
    url,
    rawDescription,
    htmlSnippet,
    language,
    topics,
    stars,
    category
  });

  // 1. Check Gemini
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    try {
      const summary = await callGemini(geminiKey, userPrompt, timeoutMs);
      if (summary) {
        return { summary, provider: 'gemini', ok: true };
      }
    } catch (err) {
      // Graceful degradation to next provider
    }
  }

  // 2. Check OpenAI-compatible API
  const llmKey = process.env.LLM_API_KEY;
  const llmBase = process.env.LLM_API_BASE;
  const llmModel = process.env.LLM_MODEL;
  if (llmKey) {
    try {
      const summary = await callOpenAICompatible(llmKey, llmBase, llmModel, userPrompt, timeoutMs);
      if (summary) {
        return { summary, provider: 'openai-compatible', ok: true };
      }
    } catch (err) {
      // Graceful degradation to next provider
    }
  }

  // 3. Check Local Ollama (if explicitly enabled or host configured)
  const ollamaHost = process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL;
  const enableOllama = process.env.ENABLE_OLLAMA === 'true' || Boolean(ollamaHost);
  if (enableOllama) {
    try {
      const summary = await callOllama(ollamaHost, process.env.OLLAMA_MODEL, userPrompt, timeoutMs);
      if (summary) {
        return { summary, provider: 'ollama', ok: true };
      }
    } catch (err) {
      // Graceful degradation
    }
  }

  // 4. Default Fallback to raw description or default summary
  let fallback = cleanSummary(rawDescription);
  if (!fallback) {
    const englishFallback = cleanSummary(rawDescription, true);
    if (englishFallback && englishFallback.length >= 6) {
      fallback = englishFallback;
    } else {
      fallback = `${title} 官方平台与实用网络资源。`;
    }
  }
  return {
    summary: fallback,
    provider: 'fallback',
    ok: false
  };
}

export const VALID_TG_SUBCATEGORIES = [
  'tools',
  'dev',
  'news',
  'network',
  'media',
  'finance',
  'community',
  'nsfw'
];

export const SUBCATEGORY_DEFAULT_TAGS = {
  tools: ['实用软件', '极客工具'],
  dev: ['编程开发', '极客技术'],
  news: ['资讯新闻', '实时动态'],
  network: ['节点网络', '主机网络'],
  media: ['影音资源', '娱乐多媒体'],
  finance: ['金融理财', '数字货币'],
  community: ['社群交流', '精选推荐'],
  nsfw: ['NSFW', '成人内容', '18+']
};

export const PROMPT_CLASSIFY_SYSTEM = `你是一个极客技术导航站的高级资深主编兼内容分类专家。
你的任务是对 Telegram 的公开频道/群组/机器人进行严格、精准的分类甄别、NSFW检测与35~55字极客推荐语编写。

【分类候选枚举（仅限以下8个小写标识符）】
1. tools: 实用软件、破解/去广告应用、Mod APK、极客脚本、电报Bot机器人、玩机工具。
2. dev: 编程开发、开源项目、技术架构、算法、学习书籍、知识研究。
3. news: 科技资讯、快讯早报、时事新闻、行业情报。
4. network: 节点网络、VPS服务器、代理客户端配置、科学上网。
5. media: 影视剧集、音乐音频、动漫二次元、美图壁纸。
6. finance: 加密货币、区块链、股票理财、金融市场。
7. community: 综合社群、生活讨论、同好圈子。
8. nsfw: 成人色情、AV、情色无码、探花、里番黄油、福利姬。

【最重要判定守则（违反视为严重事故）】
1. 软件/破解/工具优先守则：凡包含“破解软件、Mod APK、安卓去广告、免Root、iOS特权、实用工具、Bot助手”的，必须归类为 "tools"，is_nsfw 必须为 false！即使包含“老司机必备、福利软件、极客福利”等口语词，只要核心是提供软件/工具，绝对不能归为 "nsfw"。
2. 成人/色情严格界定：只有明确以传播色情成人图片/视频、AV、色情漫画/小说等色情内容为主要业务的，才允许归类为 "nsfw" 且 is_nsfw: true。如果简介或群规中出现“禁止色情/黄赌毒/NSFW”等免责声明，必须判定为 is_nsfw: false。
3. 多语言自适应与本地化守则：若原始标题或简介为英文、俄文或其他外语，必须准确识别其外语语义，自动将其提炼转化为符合 35~55 字极客中文规范的概括，绝对严禁生硬保留大段未翻译外语文本（标准英文专有名词如 Telegram, Bot API, Docker, Python, GitHub 等除外）。
4. 概括要求：35-55 字中文，以中文句号结尾。客观精炼，突出核心功能与技术特色，严禁使用“非常好用”、“赶紧加入”等空洞口号。
5. 意图标签要求：给出 3-5 个精准的高频搜索意图同义词及口语标签数组（必须包含用户高频搜索的痛点与意图口语词，如“去广告”、“科学上网”、“免费看剧”、“网盘搜索”、“免Root”、“节点订阅”等；对于海外/外语技术资源，支持精准的中英双语标签）。这些意图词将直接服务于全站即时检索与 SEO 潜在语义索引。

你必须严格输出纯 JSON 对象，不要输出任何 Markdown 代码块标记（不要写 \`\`\`json ），格式如下：
{
  "subcategory": "tools",
  "is_nsfw": false,
  "summary": "一句35到55字精炼极客中文概括，以句号结尾。",
  "tags": ["实用软件", "安卓破解", "去广告", "Mod应用"]
}`;

export function buildClassifyUserPrompt({
  title = '',
  username = '',
  rawDescription = '',
  type = 'channel',
  currentCategory = '',
  currentSubcategory = ''
}) {
  let prompt = `【待甄别 Telegram 资源信息】\n`;
  prompt += `• 标题/名称：${title || username || '未命名'}\n`;
  if (username) prompt += `• 用户名：@${username} (https://t.me/${username})\n`;
  prompt += `• 类型：${type === 'bot' ? '机器人 (Bot)' : type === 'group' ? '社群 (Group)' : '频道 (Channel)'}\n`;
  if (currentCategory || currentSubcategory) {
    prompt += `• 当前分类参考：${currentCategory || ''} / ${currentSubcategory || ''}\n`;
  }
  prompt += `• 原始简介：${rawDescription ? rawDescription.slice(0, 600) : '（无原始简介）'}\n\n`;
  prompt += `注意：若原始信息为英文或其它外语，请自适应提炼为规范极客中文概括，并生成精准中英双语标签。\n`;
  prompt += `请根据以上信息，严格输出符合规范的纯 JSON 对象：`;
  return prompt;
}

export function createFallbackClassification(fallback = {}) {
  const title = fallback.title || '';
  const desc = fallback.rawDescription || fallback.description || '';
  const category = fallback.currentCategory || fallback.category || '';
  const subcategory = fallback.currentSubcategory || fallback.subcategory || '';
  const type = fallback.type || 'channel';

  let mapped = null;
  try {
    mapped = mapTgnavCategory(category, type, title, desc);
  } catch (e) {
    // defensive
  }

  let finalSubcat = (mapped && mapped.subcat && mapped.subcat !== 'community')
    ? mapped.subcat
    : (subcategory && VALID_TG_SUBCATEGORIES.includes(subcategory) ? subcategory : (mapped?.subcat || 'community'));

  if (!VALID_TG_SUBCATEGORIES.includes(finalSubcat)) {
    finalSubcat = 'community';
  }

  let cleanDesc = cleanSummary(desc);
  let summary = cleanDesc;
  if (!summary) {
    if (desc && desc.trim().length >= 3) {
      summary = `${title ? title + '，' : ''}${desc.trim()}。`;
    } else {
      summary = `${title || fallback.username || 'Telegram 资源'} 官方公开交流与精选频道。`;
    }
  } else if (summary.length < 15 && title && !summary.includes(title)) {
    summary = `${title}，${summary}`;
  }

  const existingTags = Array.isArray(fallback.tags) ? fallback.tags.filter(Boolean) : [];
  let tags = [];
  if (existingTags.length >= 2 && (!subcategory || subcategory === finalSubcat)) {
    tags = existingTags.slice(0, 3);
  } else if (mapped && mapped.tags && mapped.tags.length) {
    tags = mapped.tags.slice(0, 3);
  } else {
    tags = SUBCATEGORY_DEFAULT_TAGS[finalSubcat] || ['精选推荐', '电报社群'];
  }

  return {
    subcategory: finalSubcat,
    is_nsfw: Boolean(mapped.isNsfw),
    summary,
    tags
  };
}

export function parseAndValidateClassificationJson(rawText, fallback = {}) {
  if (!rawText || typeof rawText !== 'string') {
    return createFallbackClassification(fallback);
  }

  // 1. Strip markdown fences
  let text = rawText.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 2. Extract outermost {...}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    text = match[0];
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return createFallbackClassification(fallback);
  }

  if (!parsed || typeof parsed !== 'object') {
    return createFallbackClassification(fallback);
  }

  // 3. Subcategory validation & synonym mapping
  let subcat = String(parsed.subcategory || '').trim().toLowerCase();
  const SYNONYM_MAP = {
    tool: 'tools', software: 'tools', app: 'tools', apps: 'tools', bot: 'tools', bots: 'tools',
    development: 'dev', code: 'dev', programming: 'dev', study: 'dev', tech: 'dev',
    information: 'news', article: 'news',
    proxy: 'network', vpn: 'network', server: 'network', vps: 'network',
    video: 'media', music: 'media', anime: 'media', acg: 'media',
    crypto: 'finance', btc: 'finance',
    chat: 'community', social: 'community', group: 'community',
    adult: 'nsfw', porn: 'nsfw', r18: 'nsfw', sex: 'nsfw'
  };
  if (SYNONYM_MAP[subcat]) {
    subcat = SYNONYM_MAP[subcat];
  }

  if (!VALID_TG_SUBCATEGORIES.includes(subcat)) {
    subcat = fallback.currentSubcategory && VALID_TG_SUBCATEGORIES.includes(fallback.currentSubcategory)
      ? fallback.currentSubcategory
      : 'community';
  }

  // 4. is_nsfw boolean normalization
  let isNsfw = false;
  if (typeof parsed.is_nsfw === 'boolean') {
    isNsfw = parsed.is_nsfw;
  } else if (typeof parsed.is_nsfw === 'string') {
    isNsfw = parsed.is_nsfw.trim().toLowerCase() === 'true';
  }

  // Double-check alignment: if subcat is nsfw, isNsfw must be true
  if (subcat === 'nsfw') {
    isNsfw = true;
  }

  // Defense-in-depth: If isNsfw is true but text shows it is a software/tech/tool resource
  const textToCheck = `${fallback.title || ''} ${fallback.rawDescription || ''} ${parsed.summary || ''}`.toLowerCase();
  const isSoftwareTool = /破解|软件|apk|安卓|root|去广告|xp模块|插件|工具箱|巨魔|trollstore|clash|surge|shadowrocket/i.test(textToCheck);
  const isExplicitAdult = /missav|黄油|里番|探花|情色|色情|成人|自慰|无码|\bav\b|本子|色图|福利姬/i.test(textToCheck);
  if (isSoftwareTool && !isExplicitAdult) {
    isNsfw = false;
    if (subcat === 'nsfw') subcat = 'tools';
  }

  // 5. Summary validation & normalization
  let summary = cleanSummary(parsed.summary);
  if (!summary || summary.length < 10) {
    summary = cleanSummary(fallback.rawDescription) || `${fallback.title || fallback.username || 'Telegram 资源'} 官方公开交流与精选频道。`;
  }

  // 6. Tags validation
  let tags = [];
  if (Array.isArray(parsed.tags)) {
    tags = parsed.tags
      .map(t => String(t || '').trim().replace(/^#+/, ''))
      .filter(t => t.length >= 2 && t.length <= 20);
  }
  if (tags.length === 0) {
    tags = SUBCATEGORY_DEFAULT_TAGS[subcat] || ['精选推荐', '电报社群'];
  } else if (tags.length > 5) {
    tags = tags.slice(0, 5);
  }

  return {
    subcategory: subcat,
    is_nsfw: isNsfw,
    summary,
    tags
  };
}

async function callGeminiClassify(apiKey, userPrompt, timeoutMs = 8000) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    systemInstruction: { parts: [{ text: PROMPT_CLASSIFY_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  let res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok && res.status === 400) {
    delete payload.generationConfig.thinkingConfig;
    delete payload.generationConfig.responseMimeType;
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  }

  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenAIClassify(apiKey, apiBase, model, userPrompt, timeoutMs = 5000) {
  const normalizedBase = (apiBase || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const endpoint = `${normalizedBase}/chat/completions`;

  const payload = {
    model: model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: PROMPT_CLASSIFY_SYSTEM },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  };

  let res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok && res.status === 400) {
    delete payload.response_format;
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  }

  if (!res.ok) {
    throw new Error(`OpenAI-compatible HTTP ${res.status}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function callOllamaClassify(host, model, userPrompt, timeoutMs = 5000) {
  const normalizedHost = (host || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const endpoint = `${normalizedHost}/api/generate`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'qwen2.5:7b',
      system: PROMPT_CLASSIFY_SYSTEM,
      prompt: userPrompt,
      format: 'json',
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: 256
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}`);
  }

  const data = await res.json();
  return data?.response || '';
}

export async function classifyAndSummarizeWithLLM(
  { title = '', username = '', rawDescription = '', type = 'channel', currentCategory = '', currentSubcategory = '', tags = [] },
  options = {}
) {
  const timeoutMs = options.timeoutMs || 5000;
  const userPrompt = buildClassifyUserPrompt({
    title,
    username,
    rawDescription,
    type,
    currentCategory,
    currentSubcategory
  });

  const fallbackContext = {
    title,
    username,
    rawDescription,
    type,
    currentCategory,
    currentSubcategory,
    tags
  };

  // 1. Check Gemini
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    try {
      const rawText = await callGeminiClassify(geminiKey, userPrompt, timeoutMs);
      if (rawText) {
        const parsed = parseAndValidateClassificationJson(rawText, fallbackContext);
        if (parsed) {
          return { ...parsed, provider: 'gemini', ok: true };
        }
      }
    } catch (err) {
      // Graceful degradation
    }
  }

  // 2. Check OpenAI-compatible API
  const llmKey = process.env.LLM_API_KEY;
  const llmBase = process.env.LLM_API_BASE;
  const llmModel = process.env.LLM_MODEL;
  if (llmKey) {
    try {
      const rawText = await callOpenAIClassify(llmKey, llmBase, llmModel, userPrompt, timeoutMs);
      if (rawText) {
        const parsed = parseAndValidateClassificationJson(rawText, fallbackContext);
        if (parsed) {
          return { ...parsed, provider: 'openai-compatible', ok: true };
        }
      }
    } catch (err) {
      // Graceful degradation
    }
  }

  // 3. Check Local Ollama
  const ollamaHost = process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL;
  const enableOllama = process.env.ENABLE_OLLAMA === 'true' || Boolean(ollamaHost);
  if (enableOllama) {
    try {
      const rawText = await callOllamaClassify(ollamaHost, process.env.OLLAMA_MODEL, userPrompt, timeoutMs);
      if (rawText) {
        const parsed = parseAndValidateClassificationJson(rawText, fallbackContext);
        if (parsed) {
          return { ...parsed, provider: 'ollama', ok: true };
        }
      }
    } catch (err) {
      // Graceful degradation
    }
  }

  // 4. Default Fallback
  return {
    ...createFallbackClassification(fallbackContext),
    provider: 'fallback',
    ok: false
  };
}

export {
  cleanSummary,
  buildUserPrompt,
  PROMPT_SYSTEM
};

