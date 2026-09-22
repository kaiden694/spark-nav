/**
 * nav-search-worker.js
 * Dedicated Web Worker for off-thread search scoring and indexing.
 * Prevents UI micro-stutters during rapid keystroke input over 10,000+ items.
 * Supports frequency-weighted ranking, user favorites boost, and alive state status.
 */

let indexedItems = [];
let visitCounts = {};
let favoriteIds = new Set();

self.onmessage = function(e) {
  const data = e.data || {};
  const action = data.action;

  if (action === 'INIT') {
    const rawItems = data.items || [];
    if (data.visitCounts) visitCounts = data.visitCounts;
    if (data.favorites && Array.isArray(data.favorites)) {
      favoriteIds = new Set(data.favorites);
    }

    indexedItems = rawItems.map(function(item) {
      return {
        id: item.id || '',
        title: item.title || '',
        url: item.url || '',
        item_type: item.item_type || 'website',
        tg_type: item.tg_type || '',
        owner: item.owner || '',
        icon: item.icon || '',
        stat: item.stat || '',
        description: item.description || '',
        search_text: (item.search_text || '').toLowerCase(),
        title_lower: (item.title || '').toLowerCase(),
        tags_lower: Array.isArray(item.tags) ? item.tags.map(function(t) { return String(t).toLowerCase(); }) : [],
        url_lower: (item.url || '').toLowerCase(),
        py_init: item.py_init || '',
        py_full: item.py_full || '',
        is_alive: item.is_alive !== false,
        mirror_urls: item.mirror_urls || [],
        feed_url: item.feed_url || ''
      };
    });

    self.postMessage({
      action: 'INIT_SUCCESS',
      count: indexedItems.length
    });
    return;
  }

  if (action === 'SYNC_METRICS') {
    if (data.visitCounts) visitCounts = data.visitCounts;
    if (data.favorites && Array.isArray(data.favorites)) {
      favoriteIds = new Set(data.favorites);
    }
    return;
  }

  if (action === 'SEARCH') {
    const query = (data.query || '').trim().toLowerCase();
    const filter = data.filter || 'all';
    const limit = data.limit || 50;

    const tokens = query ? query.split(/\s+/).filter(Boolean) : [];

    // Filter by type first
    let candidates = indexedItems;
    if (filter !== 'all') {
      if (filter === 'favorite') {
        candidates = candidates.filter(function(item) {
          return favoriteIds.has(item.id);
        });
      } else {
        candidates = candidates.filter(function(item) {
          return item.item_type === filter;
        });
      }
    }

    if (!tokens.length) {
      // Return top candidates with favorites and high visit count elevated
      const zeroScored = candidates.map(function(item) {
        let score = 0;
        const isFav = favoriteIds.has(item.id);
        const visits = visitCounts[item.id] || 0;
        if (isFav) score += 35;
        if (visits > 0) score += Math.min(visits * 8, 80);
        if (item.is_alive === false) score -= 250;
        return {
          item: Object.assign({}, item, {
            _isFavorite: isFav,
            _visitCount: visits
          }),
          score: score
        };
      });

      zeroScored.sort(function(a, b) {
        return b.score - a.score;
      });

      self.postMessage({
        action: 'SEARCH_SUCCESS',
        query: query,
        filter: filter,
        results: zeroScored.slice(0, limit).map(function(s) { return s.item; }),
        totalMatched: candidates.length
      });
      return;
    }

    // Match all tokens & calculate relevance score
    const scored = [];
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      let matchesAll = true;
      let score = 0;

      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t];
        const inSearchText = item.search_text.indexOf(token);
        if (inSearchText === -1) {
          matchesAll = false;
          break;
        }

        // Token matching scoring with Pinyin ranking hierarchy
        if (item.title_lower === token) {
          score += 100;
        } else if (item.title_lower.startsWith(token)) {
          score += 50;
        } else if (item.py_init && item.py_init === token) {
          score += 90; // Exact pinyin initials match (e.g. "pjrj" matches "破解软件")
        } else if (item.py_full && item.py_full === token) {
          score += 90; // Exact full pinyin match (e.g. "pojie" matches "破解")
        } else if (item.py_init && item.py_init.startsWith(token)) {
          score += 45; // Prefix pinyin initials match (e.g. "pj" matches "破解软件...")
        } else if (item.py_full && item.py_full.startsWith(token)) {
          score += 45; // Prefix full pinyin match (e.g. "pojie" matches "破解软件...")
        } else if (item.title_lower.indexOf(token) !== -1) {
          score += 25;
        } else if (item.py_init && item.py_init.indexOf(token) !== -1) {
          score += 20; // Substring pinyin initials
        } else if (item.py_full && item.py_full.indexOf(token) !== -1) {
          score += 20; // Substring full pinyin
        } else if (item.tags_lower && item.tags_lower.indexOf(token) !== -1) {
          score += 35; // Exact tag match
        } else if (item.url_lower && item.url_lower.indexOf(token) !== -1) {
          score += 25; // URL / username match
        } else {
          score += 8;
        }
      }

      if (matchesAll) {
        const isFav = favoriteIds.has(item.id);
        const visits = visitCounts[item.id] || 0;
        if (isFav) score += 35;
        if (visits > 0) score += Math.min(visits * 8, 80);
        if (item.is_alive === false) score -= 250;

        scored.push({
          item: Object.assign({}, item, {
            _isFavorite: isFav,
            _visitCount: visits
          }),
          score: score
        });
      }
    }

    // Sort by descending score
    scored.sort(function(a, b) {
      return b.score - a.score;
    });

    const results = scored.slice(0, limit).map(function(s) {
      return s.item;
    });

    self.postMessage({
      action: 'SEARCH_RESULTS',
      query: query,
      filter: filter,
      results: results,
      totalMatched: scored.length
    });
  }
};
