/**
 * Universal Cloud Sync & Conflict Resolution Helpers for XIU Navigation
 * Implements CRDT-lite (LWW - Last-Write-Wins based on pinnedAt) and network path builders.
 */

/**
 * Smart Merge Algorithm:
 * - Performs union of local and cloud favorites by unique `id`.
 * - Resolves conflicts by comparing `pinnedAt` timestamps (latest wins).
 * - Merges non-conflicting properties (e.g. newly added metadata).
 * - Sorts final list by `pinnedAt` descending.
 * 
 * @param {Array<Object>} localList 
 * @param {Array<Object>} cloudList 
 * @returns {Array<Object>} Merged deduplicated array sorted by pinnedAt desc
 */
export function smartMergeFavorites(localList = [], cloudList = []) {
  const map = new Map();

  // Index local items
  (localList || []).forEach(item => {
    if (item && item.id) {
      map.set(item.id, { ...item });
    }
  });

  // Merge cloud items with timestamp arbitration
  (cloudList || []).forEach(cloudItem => {
    if (!cloudItem || !cloudItem.id) return;

    if (!map.has(cloudItem.id)) {
      map.set(cloudItem.id, { ...cloudItem });
    } else {
      const localItem = map.get(cloudItem.id);
      const localTime = Number(localItem.pinnedAt) || 0;
      const cloudTime = Number(cloudItem.pinnedAt) || 0;

      if (cloudTime > localTime) {
        // Cloud is newer
        map.set(cloudItem.id, { ...localItem, ...cloudItem });
      } else {
        // Local is newer or equal
        map.set(cloudItem.id, { ...cloudItem, ...localItem });
      }
    }
  });

  const merged = Array.from(map.values());
  merged.sort((a, b) => (Number(b.pinnedAt) || 0) - (Number(a.pinnedAt) || 0));
  return merged;
}

/**
 * Build GitHub Gist Payload
 * @param {Array<Object>} favorites 
 * @param {string} description 
 * @param {boolean} isPublic 
 */
export function buildGistPayload(favorites, description = 'XIU Nav Favorites Cloud Backup', isPublic = false) {
  return {
    description,
    public: Boolean(isPublic),
    files: {
      'xiu-nav-favorites.json': {
        content: JSON.stringify(favorites || [], null, 2)
      }
    }
  };
}

/**
 * Normalizes WebDAV base URL and subpath into a clean absolute endpoint URL
 * @param {string} baseUrl e.g. "https://dav.jianguoyun.com/dav/"
 * @param {string} targetPath e.g. "/xiu-nav/favorites.json"
 * @returns {string} Combined normalized URL
 */
export function buildWebDAVTargetUrl(baseUrl, targetPath = '/xiu-nav/favorites.json') {
  if (!baseUrl) throw new Error('WebDAV baseUrl is required');
  const cleanBase = baseUrl.trim().replace(/\/+$/, '');
  const cleanPath = targetPath.trim().replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

/**
 * Validate Sync Configuration
 * @param {Object} cfg 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSyncConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    return { valid: false, error: '配置对象无效' };
  }

  if (cfg.provider === 'gist') {
    if (!cfg.gist || !cfg.gist.token || !cfg.gist.token.trim()) {
      return { valid: false, error: 'GitHub PAT Token 不能为空' };
    }
    return { valid: true };
  }

  if (cfg.provider === 'webdav') {
    if (!cfg.webdav || !cfg.webdav.url || !cfg.webdav.url.trim()) {
      return { valid: false, error: 'WebDAV 服务器地址不能为空' };
    }
    if (!cfg.webdav.user || !cfg.webdav.user.trim()) {
      return { valid: false, error: 'WebDAV 用户名不能为空' };
    }
    if (!cfg.webdav.pass || !cfg.webdav.pass.trim()) {
      return { valid: false, error: 'WebDAV 密码不能为空' };
    }
    return { valid: true };
  }

  return { valid: false, error: '未知的云同步提供商' };
}

/**
 * Universal safe Base64 encoder (works in both Node.js and Browser)
 * @param {string} str 
 * @returns {string} URL-safe Base64
 */
export function safeBase64Encode(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
    return String.fromCharCode(parseInt(p1, 16));
  }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Universal safe Base64 decoder (works in both Node.js and Browser)
 * @param {string} str 
 * @returns {string} UTF-8 decoded string
 */
export function safeBase64Decode(str) {
  var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf-8');
  }
  var raw = atob(b64);
  return decodeURIComponent(Array.prototype.map.call(raw, function(c) {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
}

/**
 * Encodes sync config into an actionable pairing URL with hash fragment
 * @param {Object} cfg 
 * @param {string} baseUrl e.g. "https://xiu-theme.pages.dev/nav.html"
 * @returns {string} Full Pairing URL
 */
export function encodePairingPayload(cfg, baseUrl = '') {
  if (!cfg) return '';
  var compact = { p: cfg.provider || 'gist', v: 1, a: Boolean(cfg.autoSync) };

  if (compact.p === 'gist' && cfg.gist) {
    compact.t = (cfg.gist.token || '').trim();
    compact.g = (cfg.gist.gistId || '').trim();
  } else if (compact.p === 'webdav' && cfg.webdav) {
    compact.u = (cfg.webdav.url || '').trim();
    compact.us = (cfg.webdav.user || '').trim();
    compact.pw = (cfg.webdav.pass || '').trim();
    compact.pt = (cfg.webdav.path || '/xiu-nav/favorites.json').trim();
  }

  var encoded = safeBase64Encode(JSON.stringify(compact));
  var cleanBase = (baseUrl || '').split('#')[0];
  return cleanBase ? `${cleanBase}#sync-pair=${encoded}` : `#sync-pair=${encoded}`;
}

/**
 * Decodes and validates pairing payload from hash or full URL
 * @param {string} hashOrUrl e.g. "#sync-pair=..." or full URL
 * @returns {Object|null} Standardized config object or null if invalid
 */
export function decodePairingPayload(hashOrUrl) {
  if (!hashOrUrl || typeof hashOrUrl !== 'string') return null;

  var match = hashOrUrl.match(/#sync-pair=([A-Za-z0-9_\-+=%]+)/);
  if (!match || !match[1]) return null;

  try {
    var rawStr = decodeURIComponent(match[1]);
    var jsonStr = safeBase64Decode(rawStr);
    var parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') return null;

    var provider = parsed.p === 'webdav' ? 'webdav' : 'gist';
    var res = {
      provider: provider,
      autoSync: parsed.a !== false,
      lastSyncTime: null,
      gist: { token: '', gistId: '' },
      webdav: { url: '', user: '', pass: '', path: '/xiu-nav/favorites.json' }
    };

    if (provider === 'gist') {
      res.gist.token = (parsed.t || '').trim();
      res.gist.gistId = (parsed.g || '').trim();
      if (!res.gist.token) return null;
    } else {
      res.webdav.url = (parsed.u || '').trim();
      res.webdav.user = (parsed.us || '').trim();
      res.webdav.pass = (parsed.pw || '').trim();
      res.webdav.path = (parsed.pt || '/xiu-nav/favorites.json').trim();
      if (!res.webdav.url || !res.webdav.user || !res.webdav.pass) return null;
    }

    return res;
  } catch (err) {
    return null;
  }
}

