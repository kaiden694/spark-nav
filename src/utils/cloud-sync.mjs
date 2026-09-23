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
