/**
 * nav-cloud-sync.js
 * Universal Cross-Device Cloud Sync & QR Code Pairing Engine
 * Pure client-side zero-knowledge implementation for XIU Navigation.
 */
(function() {
  var modal = document.getElementById('nav-cloud-sync-modal');
  if (!modal) return;

  var STORAGE_CONFIG_KEY = 'xiu_nav_cloud_sync_config';
  var FAVORITES_KEY = 'xiu_nav_user_favorites';

  var tabBtnGist = document.getElementById('tab-btn-gist');
  var tabBtnWebdav = document.getElementById('tab-btn-webdav');
  var panelGist = document.getElementById('panel-gist');
  var panelWebdav = document.getElementById('panel-webdav');

  var inputGistToken = document.getElementById('sync-gist-token');
  var inputGistId = document.getElementById('sync-gist-id');
  var btnToggleMask = document.getElementById('btn-toggle-token-mask');

  var inputWebdavUrl = document.getElementById('sync-webdav-url');
  var inputWebdavUser = document.getElementById('sync-webdav-user');
  var inputWebdavPass = document.getElementById('sync-webdav-pass');
  var inputWebdavPath = document.getElementById('sync-webdav-path');

  var cbAutoSync = document.getElementById('sync-auto-sync');
  var statusDot = document.getElementById('sync-status-dot');
  var statusText = document.getElementById('sync-status-text');
  var timeText = document.getElementById('sync-time-text');

  var btnClose = document.getElementById('nav-sync-close-btn');
  var btnClear = document.getElementById('btn-sync-clear-config');
  var btnPull = document.getElementById('btn-sync-pull');
  var btnPush = document.getElementById('btn-sync-push');
  var btnMerge = document.getElementById('btn-sync-merge');

  // QR Code Pairing Elements
  var btnShowQr = document.getElementById('btn-sync-show-qr');
  var qrOverlay = document.getElementById('nav-sync-qr-overlay');
  var btnQrClose = document.getElementById('btn-sync-qr-close');
  var qrCanvas = document.getElementById('nav-sync-qr-canvas');
  var qrLoading = document.getElementById('nav-sync-qr-loading');
  var qrTag = document.getElementById('nav-sync-qr-provider-tag');
  var btnCopyPairUrl = document.getElementById('btn-sync-copy-pair-url');

  // Incoming Scanner Confirmation Elements
  var incomingModal = document.getElementById('nav-sync-incoming-modal');
  var incomingProviderName = document.getElementById('incoming-provider-name');
  var incomingAccountId = document.getElementById('incoming-account-id');
  var incomingAutoSync = document.getElementById('incoming-auto-sync');
  var btnIncomingCancel = document.getElementById('btn-incoming-cancel');
  var btnIncomingConfirm = document.getElementById('btn-incoming-confirm');
  var pendingIncomingConfig = null;

  var activeProvider = 'gist';
  var autoSyncTimer = null;

  // Load Local Sync Config
  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      provider: 'gist',
      autoSync: true,
      lastSyncTime: null,
      gist: { token: '', gistId: '' },
      webdav: { url: '', user: '', pass: '', path: '/xiu-nav/favorites.json' }
    };
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  // Populate UI from Config
  function renderConfigUI() {
    var cfg = loadConfig();
    activeProvider = cfg.provider || 'gist';
    switchTab(activeProvider);

    if (cfg.gist) {
      inputGistToken.value = cfg.gist.token || '';
      inputGistId.value = cfg.gist.gistId || '';
    }
    if (cfg.webdav) {
      inputWebdavUrl.value = cfg.webdav.url || '';
      inputWebdavUser.value = cfg.webdav.user || '';
      inputWebdavPass.value = cfg.webdav.pass || '';
      inputWebdavPath.value = cfg.webdav.path || '/xiu-nav/favorites.json';
    }
    cbAutoSync.checked = cfg.autoSync !== false;

    updateStatusUI(cfg);
  }

  function updateStatusUI(cfg) {
    if (cfg.lastSyncTime) {
      var dt = new Date(cfg.lastSyncTime);
      var timeStr = dt.getFullYear() + '-' +
        String(dt.getMonth() + 1).padStart(2, '0') + '-' +
        String(dt.getDate()).padStart(2, '0') + ' ' +
        String(dt.getHours()).padStart(2, '0') + ':' +
        String(dt.getMinutes()).padStart(2, '0');
      timeText.textContent = '上次同步: ' + timeStr;
    } else {
      timeText.textContent = '上次同步: 从未';
    }

    var hasConfig = (activeProvider === 'gist' && inputGistToken.value.trim()) ||
                    (activeProvider === 'webdav' && inputWebdavUrl.value.trim() && inputWebdavUser.value.trim());

    if (hasConfig) {
      statusDot.className = 'status-indicator ready';
      statusText.textContent = '配置就绪 · 点击按钮可同步';
    } else {
      statusDot.className = 'status-indicator';
      statusText.textContent = '未配置云端授权密钥';
    }
  }

  function switchTab(prov) {
    activeProvider = prov;
    if (prov === 'gist') {
      tabBtnGist.classList.add('is-active');
      tabBtnWebdav.classList.remove('is-active');
      panelGist.style.display = 'block';
      panelWebdav.style.display = 'none';
    } else {
      tabBtnWebdav.classList.add('is-active');
      tabBtnGist.classList.remove('is-active');
      panelWebdav.style.display = 'block';
      panelGist.style.display = 'none';
    }
  }

  // Modal Visibility
  function openModal() {
    renderConfigUI();
    modal.style.display = 'flex';
    requestAnimationFrame(function() {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
    });
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    setTimeout(function() {
      if (!modal.classList.contains('is-open')) {
        modal.style.display = 'none';
      }
    }, 220);
  }

  // Gather latest settings from UI
  function harvestConfig() {
    var cfg = loadConfig();
    cfg.provider = activeProvider;
    cfg.autoSync = cbAutoSync.checked;
    cfg.gist = {
      token: inputGistToken.value.trim(),
      gistId: inputGistId.value.trim()
    };
    cfg.webdav = {
      url: inputWebdavUrl.value.trim(),
      user: inputWebdavUser.value.trim(),
      pass: inputWebdavPass.value.trim(),
      path: inputWebdavPath.value.trim() || '/xiu-nav/favorites.json'
    };
    saveConfig(cfg);
    return cfg;
  }

  // Smart Merge Algorithm (CRDT-lite union with timestamp arbitration)
  function smartMergeFavorites(localList, cloudList) {
    var map = new Map();
    
    // Index local items
    (localList || []).forEach(function(item) {
      if (item && item.id) map.set(item.id, item);
    });

    // Merge cloud items
    (cloudList || []).forEach(function(cItem) {
      if (!cItem || !cItem.id) return;
      if (!map.has(cItem.id)) {
        map.set(cItem.id, cItem);
      } else {
        var lItem = map.get(cItem.id);
        var lTime = lItem.pinnedAt || 0;
        var cTime = cItem.pinnedAt || 0;
        if (cTime > lTime) {
          map.set(cItem.id, Object.assign({}, lItem, cItem));
        } else {
          map.set(cItem.id, Object.assign({}, cItem, lItem));
        }
      }
    });

    var merged = Array.from(map.values());
    merged.sort(function(a, b) {
      return (b.pinnedAt || 0) - (a.pinnedAt || 0);
    });
    return merged;
  }

  // Helper: Toast notice
  function notify(msg) {
    if (typeof window.showNavToast === 'function') {
      window.showNavToast(msg);
    }
  }

  // ==================== GitHub Gist Core Engine ====================
  async function syncGistPull(token, gistId) {
    if (!token) throw new Error('请先填写 GitHub Personal Access Token');
    if (!gistId) throw new Error('未指定 Gist ID，无法从云端拉取');

    var res = await fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json'
      }
    });
    if (!res.ok) {
      if (res.status === 404) throw new Error('未找到指定 Gist，请检查 Gist ID 是否正确');
      if (res.status === 401) throw new Error('GitHub Token 认证失败，请检查是否具备 gist 权限');
      throw new Error('GitHub API 返回异常: HTTP ' + res.status);
    }
    var gistData = await res.json();
    var file = gistData.files && (gistData.files['xiu-nav-favorites.json'] || Object.values(gistData.files)[0]);
    if (!file || !file.content) return [];
    try {
      var parsed = JSON.parse(file.content);
      return Array.isArray(parsed) ? parsed : (parsed.favorites || []);
    } catch (err) {
      throw new Error('Gist 文件内容不是有效的 JSON 数组');
    }
  }

  async function syncGistPush(token, gistId, list) {
    if (!token) throw new Error('请先填写 GitHub Personal Access Token');
    var payload = {
      description: 'XIU Nav Favorites Cloud Backup',
      files: {
        'xiu-nav-favorites.json': {
          content: JSON.stringify(list, null, 2)
        }
      }
    };

    if (!gistId) {
      // Create new private Gist
      payload.public = false;
      var createRes = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify(payload)
      });
      if (!createRes.ok) throw new Error('创建 Gist 失败: HTTP ' + createRes.status);
      var created = await createRes.json();
      return created.id;
    } else {
      // Update existing Gist
      var updateRes = await fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify(payload)
      });
      if (!updateRes.ok) throw new Error('更新 Gist 失败: HTTP ' + updateRes.status);
      return gistId;
    }
  }

  // ==================== WebDAV Core Engine ====================
  async function syncWebDAVPull(url, user, pass, path) {
    if (!url || !user || !pass) throw new Error('请完整填写 WebDAV 服务器、账号及授权密码');
    var targetUrl = url.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
    var auth = 'Basic ' + btoa(user + ':' + pass);

    var res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Authorization': auth }
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('WebDAV 拉取失败: HTTP ' + res.status);
    var text = await res.text();
    try {
      var parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : (parsed.favorites || []);
    } catch (e) {
      throw new Error('WebDAV 文件格式解析失败');
    }
  }

  async function syncWebDAVPush(url, user, pass, path, list) {
    if (!url || !user || !pass) throw new Error('请完整填写 WebDAV 服务器、账号及授权密码');
    var targetUrl = url.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
    var auth = 'Basic ' + btoa(user + ':' + pass);

    var res = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(list, null, 2)
    });
    if (!res.ok) throw new Error('WebDAV 推送失败: HTTP ' + res.status);
    return true;
  }

  // ==================== Dispatcher Actions ====================
  async function performAction(actionType) {
    var cfg = harvestConfig();
    statusDot.className = 'status-indicator syncing';
    statusText.textContent = '正在连接云端 (' + (activeProvider === 'gist' ? 'GitHub' : 'WebDAV') + ')...';

    try {
      var localList = (typeof window.getNavFavorites === 'function') ? window.getNavFavorites() : [];
      var cloudList = [];
      var effectiveGistId = cfg.gist.gistId;

      // 1. Fetch Cloud
      if (activeProvider === 'gist') {
        if (actionType !== 'push' || effectiveGistId) {
          cloudList = await syncGistPull(cfg.gist.token, effectiveGistId);
        }
      } else {
        cloudList = await syncWebDAVPull(cfg.webdav.url, cfg.webdav.user, cfg.webdav.pass, cfg.webdav.path);
      }

      // 2. Compute Resolution
      var finalList = [];
      if (actionType === 'pull') {
        finalList = cloudList;
        notify('✓ 已成功从云端拉取覆盖本地 (共 ' + finalList.length + ' 项)');
      } else if (actionType === 'push') {
        finalList = localList;
        if (activeProvider === 'gist') {
          effectiveGistId = await syncGistPush(cfg.gist.token, effectiveGistId, finalList);
          cfg.gist.gistId = effectiveGistId;
          inputGistId.value = effectiveGistId;
        } else {
          await syncWebDAVPush(cfg.webdav.url, cfg.webdav.user, cfg.webdav.pass, cfg.webdav.path, finalList);
        }
        notify('✓ 本地收藏已完全推送至云端 (共 ' + finalList.length + ' 项)');
      } else {
        // Merge
        finalList = smartMergeFavorites(localList, cloudList);
        if (activeProvider === 'gist') {
          effectiveGistId = await syncGistPush(cfg.gist.token, effectiveGistId, finalList);
          cfg.gist.gistId = effectiveGistId;
          inputGistId.value = effectiveGistId;
        } else {
          await syncWebDAVPush(cfg.webdav.url, cfg.webdav.user, cfg.webdav.pass, cfg.webdav.path, finalList);
        }
        notify('✓ 云端与本地双向智能合并完成 (最终共 ' + finalList.length + ' 项)');
      }

      // 3. Update Local Storage & State Store
      if (typeof window.saveNavFavorites === 'function') {
        window.saveNavFavorites(finalList);
      } else {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(finalList));
      }

      window.dispatchEvent(new CustomEvent('nav-favorites-updated', {
        detail: { favorites: finalList, targetId: null, isPinned: false }
      }));

      cfg.lastSyncTime = Date.now();
      saveConfig(cfg);
      updateStatusUI(cfg);
      statusDot.className = 'status-indicator ready';
      statusText.textContent = '同步成功！数据已为最新';
    } catch (err) {
      statusDot.className = 'status-indicator error';
      statusText.textContent = '同步失败: ' + err.message;
      notify('❌ 同步失败: ' + err.message);
    }
  }

  // Auto-Sync Debounce Trigger
  function triggerAutoSync() {
    var cfg = loadConfig();
    if (!cfg.autoSync) return;
    var canSync = (cfg.provider === 'gist' && cfg.gist.token && cfg.gist.gistId) ||
                  (cfg.provider === 'webdav' && cfg.webdav.url && cfg.webdav.user && cfg.webdav.pass);
    if (!canSync) return;

    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(function() {
      performAction('merge');
    }, 3500);
  }

  // ==================== Cross-Device QR Pairing Engine ====================
  function safeBase64Encode(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
      return String.fromCharCode(parseInt(p1, 16));
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function safeBase64Decode(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var raw = atob(b64);
    return decodeURIComponent(Array.prototype.map.call(raw, function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
  }

  function encodePairingPayload(cfg, baseUrl) {
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
    return cleanBase ? cleanBase + '#sync-pair=' + encoded : '#sync-pair=' + encoded;
  }

  function decodePairingPayload(hashOrUrl) {
    if (!hashOrUrl || typeof hashOrUrl !== 'string') return null;
    var match = hashOrUrl.match(/#sync-pair=([A-Za-z0-9_\-]+)/);
    if (!match || !match[1]) return null;
    try {
      var jsonStr = safeBase64Decode(match[1]);
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
    } catch (e) {
      return null;
    }
  }

  function loadQRCodeLib(cb) {
    if (window.QRCodeLite) {
      cb(window.QRCodeLite);
      return;
    }
    var s = document.createElement('script');
    s.src = '/assets/js/qrcode-lite.js';
    s.onload = function() { cb(window.QRCodeLite); };
    s.onerror = function() {
      notify('❌ 加载离线二维码引擎失败');
    };
    document.head.appendChild(s);
  }

  function showQROverlay() {
    var cfg = harvestConfig();
    var hasConfig = (cfg.provider === 'gist' && cfg.gist && cfg.gist.token) ||
                    (cfg.provider === 'webdav' && cfg.webdav && cfg.webdav.url && cfg.webdav.user && cfg.webdav.pass);

    if (!hasConfig) {
      notify('⚠️ 请先填写并配置有效的云端授权凭据');
      return;
    }

    var originUrl = window.location.origin + window.location.pathname;
    var pairUrl = encodePairingPayload(cfg, originUrl);

    if (qrTag) qrTag.textContent = cfg.provider === 'gist' ? '🐙 GitHub Gist' : '📁 WebDAV';
    if (qrOverlay) qrOverlay.style.display = 'flex';
    if (qrLoading) qrLoading.style.display = 'flex';
    if (qrCanvas) qrCanvas.style.display = 'none';

    loadQRCodeLib(function(qrEngine) {
      if (!qrEngine) return;
      try {
        qrEngine.toCanvas(qrCanvas, pairUrl, { width: 200, margin: 2 });
        if (qrLoading) qrLoading.style.display = 'none';
        if (qrCanvas) qrCanvas.style.display = 'block';
      } catch (err) {
        if (qrLoading) qrLoading.textContent = '生成失败: ' + err.message;
      }
    });

    if (btnCopyPairUrl) {
      btnCopyPairUrl.onclick = function() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(pairUrl).then(function() {
            notify('✓ 配对直达链接已复制到剪贴板');
          });
        } else {
          notify('✓ 请直接在手机端扫码连接');
        }
      };
    }
  }

  function closeQROverlay() {
    if (qrOverlay) qrOverlay.style.display = 'none';
  }

  // Incoming Scanner Confirmation Handler
  function checkIncomingPairing() {
    var hash = window.location.hash;
    if (!hash || hash.indexOf('#sync-pair=') === -1) return;

    var incoming = decodePairingPayload(hash);
    // Immediately wipe the sensitive hash from the URL bar to protect credentials!
    if (window.history && window.history.replaceState) {
      var cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', cleanUrl);
    } else {
      window.location.hash = '';
    }

    if (!incoming || !incomingModal) {
      if (!incoming) notify('⚠️ 配对请求格式无效或凭据已损坏');
      return;
    }

    pendingIncomingConfig = incoming;

    // Populate Incoming Modal
    if (incomingProviderName) {
      incomingProviderName.textContent = incoming.provider === 'gist' ? '🐙 GitHub Gist' : '📁 WebDAV';
    }
    if (incomingAccountId) {
      if (incoming.provider === 'gist') {
        var rawTok = incoming.gist.token;
        var maskTok = rawTok.length > 8 ? rawTok.slice(0, 4) + '••••' + rawTok.slice(-4) : '••••';
        incomingAccountId.textContent = maskTok + (incoming.gist.gistId ? ' (ID: ' + incoming.gist.gistId.slice(0, 6) + '...)' : '');
      } else {
        incomingAccountId.textContent = incoming.webdav.user + '@' + incoming.webdav.url.replace(/^https?:\/\//, '').split('/')[0];
      }
    }
    if (incomingAutoSync) {
      incomingAutoSync.textContent = incoming.autoSync ? '已开启 (3秒自动同步)' : '关闭';
    }

    // Open Incoming Modal
    incomingModal.style.display = 'flex';
    requestAnimationFrame(function() {
      incomingModal.classList.add('is-open');
    });
  }

  function closeIncomingModal() {
    if (!incomingModal) return;
    incomingModal.classList.remove('is-open');
    setTimeout(function() {
      incomingModal.style.display = 'none';
      pendingIncomingConfig = null;
    }, 200);
  }

  // Event Bindings
  tabBtnGist.addEventListener('click', function() { switchTab('gist'); harvestConfig(); });
  tabBtnWebdav.addEventListener('click', function() { switchTab('webdav'); harvestConfig(); });

  btnToggleMask.addEventListener('click', function() {
    if (inputGistToken.type === 'password') {
      inputGistToken.type = 'text';
      btnToggleMask.textContent = '🙈';
    } else {
      inputGistToken.type = 'password';
      btnToggleMask.textContent = '👁️';
    }
  });

  btnClose.addEventListener('click', closeModal);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeModal();
  });

  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (qrOverlay && qrOverlay.style.display !== 'none') {
        closeQROverlay();
      } else if (modal.classList.contains('is-open')) {
        closeModal();
      }
    }
  });

  btnPull.addEventListener('click', function() { performAction('pull'); });
  btnPush.addEventListener('click', function() { performAction('push'); });
  btnMerge.addEventListener('click', function() { performAction('merge'); });

  btnClear.addEventListener('click', function() {
    if (confirm('确定要清除保存在本机的云端同步 Token 与账号凭据吗？')) {
      localStorage.removeItem(STORAGE_CONFIG_KEY);
      renderConfigUI();
      notify('✓ 已安全清除本机云端同步凭据');
    }
  });

  // Event Bindings for QR & Incoming
  if (btnShowQr) btnShowQr.addEventListener('click', showQROverlay);
  if (btnQrClose) btnQrClose.addEventListener('click', closeQROverlay);

  if (btnIncomingCancel) {
    btnIncomingCancel.addEventListener('click', function() {
      closeIncomingModal();
      notify('已取消导入跨端云同步配置');
    });
  }

  if (btnIncomingConfirm) {
    btnIncomingConfirm.addEventListener('click', function() {
      if (!pendingIncomingConfig) return;
      saveConfig(pendingIncomingConfig);
      renderConfigUI();
      closeIncomingModal();
      notify('✓ 跨设备配对成功！正在同步云端收藏...');
      performAction('merge');
    });
  }

  // Listen for favorite mutations to trigger auto sync
  window.addEventListener('nav-favorites-updated', function() {
    triggerAutoSync();
  });

  // Check incoming pairing hash immediately on page load
  checkIncomingPairing();

  // Global API exports
  window.openNavCloudSyncModal = openModal;
  window.closeNavCloudSyncModal = closeModal;
  window.smartMergeFavorites = smartMergeFavorites;
  window.openNavCloudSyncQR = showQROverlay;
  window.closeNavCloudSyncQR = closeQROverlay;
  window.checkNavIncomingPairing = checkIncomingPairing;
})();
