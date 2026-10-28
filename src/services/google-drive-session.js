/* Google Identity Services + Picker, jeton exclusivement en mémoire.
 * Aucun accès au stockage. Même client Web et même projet pour les deux origines.
 * Les bibliothèques Google ne sont chargées qu'après un geste explicite.
 */
const GoogleDriveSession = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  function config(value, origin = globalThis.location && location.origin) {
    const fields = ['approved', 'clientId', 'apiKey', 'appId', 'raceOrigin', 'vaultOrigin'];
    if (!value || typeof value !== 'object' || Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k)) ||
      value.approved !== true || typeof value.clientId !== 'string' || !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.clientId) ||
      typeof value.apiKey !== 'string' || !/^AIza[A-Za-z0-9_-]{35}$/.test(value.apiKey) || typeof value.appId !== 'string' || !/^[0-9]{6,30}$/.test(value.appId) || !value.clientId.startsWith(value.appId + '-')) return fail('configuration');
    for (const field of ['raceOrigin', 'vaultOrigin']) {
      let u; try { u = new URL(value[field]); } catch { return fail('origin'); }
      if (u.origin !== value[field] || u.protocol !== 'https:' || u.username || u.password || u.port ||
        !u.hostname.includes('.') || /(^|\.)(github\.io|localhost|local|test|invalid)$/.test(u.hostname) ||
        /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return fail('origin');
    }
    if (value.raceOrigin === value.vaultOrigin || ![value.raceOrigin, value.vaultOrigin].includes(origin)) return fail('origin');
    return Object.freeze({ ...value });
  }
  async function load(fetcher = fetch) {
    const r = await fetcher('./drive-config.json', { credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) });
    if (!r.ok || Number(r.headers.get('Content-Length') || 0) > 2048) return fail('configuration');
    const reader = r.body && r.body.getReader(); if (!reader) return fail('configuration');
    let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2048) return fail('configuration'); text += decoder.decode(value, { stream: true }); } text += decoder.decode(); }
    finally { await reader.cancel().catch(() => {}); }
    return config(JSON.parse(text));
  }
  function create(input, provider, host = globalThis) {
    const cfg = config(input, host.location.origin);
    let token = null, until = 0, epoch = 0, prepared = false, pending = null, picker = null, pickReject = null, pickerBusy = false, identity = null, approvedAccount = null, pendingFolder = null;
    let dedicated = new Set();
    const script = src => new Promise((resolve, reject) => {
      const el = host.document.createElement('script'); el.src = src; el.async = true; el.referrerPolicy = 'strict-origin-when-cross-origin';
      const timer = setTimeout(() => { el.remove(); reject(Object.assign(new Error('network'), { code: 'network' })); }, 20000);
      el.onload = () => { clearTimeout(timer); resolve(); }; el.onerror = () => { clearTimeout(timer); el.remove(); reject(Object.assign(new Error('network'), { code: 'network' })); };
      host.document.head.appendChild(el);
    });
    function disconnect() {
      token = null; until = 0; identity = approvedAccount = pendingFolder = null; dedicated = new Set(); pickerBusy = false; epoch++; provider.disconnect(); picker?.setVisible(false); picker = null;
      if (pickReject) { pickReject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); pickReject = null; }
      if (pending) { pending.reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); pending = null; }
    }
    async function prepare() {
      config(cfg, host.location.origin);
      if (!host.google?.accounts?.oauth2) await script('https://accounts.google.com/gsi/client');
      if (!host.gapi?.load) await script('https://apis.google.com/js/api.js');
      await new Promise((resolve, reject) => host.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('network')), timeout: 20000, ontimeout: () => reject(new Error('network')) }));
      prepared = true;
    }
    // Chaque demande a son propre callback/epoch : une réponse tardive de la
    // fenêtre de l'ancien compte ne peut pas authentifier la nouvelle demande.
    function connect() {
      if (!prepared || pending) return Promise.reject(Object.assign(new Error('configuration'), { code: 'configuration' }));
      disconnect();
      return new Promise((resolve, reject) => {
        const request = { resolve, reject, epoch }; pending = request;
        const client = host.google.accounts.oauth2.initTokenClient({ client_id: cfg.clientId, scope: SCOPE, include_granted_scopes: false,
          callback: async response => {
            if (request !== pending || request.epoch !== epoch) return;
            try {
              if (response.error || typeof response.access_token !== 'string' ||
                !host.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE) || response.scope?.split(/\s+/).filter(Boolean).join(' ') !== SCOPE) return fail('auth');
              const seconds = Number(response.expires_in);
              provider.connect(response.access_token, seconds, [SCOPE]);
              token = response.access_token; until = Date.now() + (seconds - 30) * 1000;
              const selected = await provider.identity();
              if (request !== pending || request.epoch !== epoch) return;
              identity = Object.freeze({ ...selected }); pending = null; request.resolve();
            } catch { if (request !== pending || request.epoch !== epoch) return; pending = null; disconnect(); request.reject(Object.assign(new Error('auth'), { code: 'auth' })); }
          }, error_callback: () => { if (request !== pending || request.epoch !== epoch) return; pending = null; disconnect(); request.reject(Object.assign(new Error('auth'), { code: 'auth' })); } });
        try { client.requestAccessToken({ prompt: 'select_account' }); }
        catch { pending = null; disconnect(); reject(Object.assign(new Error('auth'), { code: 'auth' })); }
      });
    }
    function confirmAccount(accountId) {
      if (!token || Date.now() >= until || !identity || identity.id !== accountId) return fail('confirmation');
      approvedAccount = accountId;
    }
    function fileAccess() {
      if (!token || Date.now() >= until || provider.connected === false) { disconnect(); return fail('auth'); }
      if (!identity || approvedAccount !== identity.id) return fail('confirmation');
      // Invalider toutes les réponses de l'ancienne destination, sans partager le jeton.
      provider.connect(token, Math.floor((until - Date.now()) / 1000) + 30, [SCOPE]);
    }
    async function newFolder() {
      fileAccess(); const lease = epoch, account = await provider.account();
      if (lease !== epoch || account !== approvedAccount) return fail('auth');
      if (!pendingFolder) { const reserved = await provider.reserveId(); if (lease !== epoch) return fail('auth'); pendingFolder = reserved; }
      const folder = await provider.createFolder(pendingFolder);
      if (lease !== epoch || Date.now() >= until) return fail('auth');
      return folder;
    }
    async function listDedicatedFolders() {
      fileAccess(); dedicated = new Set(); const lease = epoch, account = await provider.account();
      if (lease !== epoch || account !== approvedAccount) return fail('auth');
      const folders = await provider.folders();
      if (lease !== epoch || Date.now() >= until) return fail('auth');
      dedicated = new Set(folders.map(f => f.id));
      return folders.map(f => Object.freeze({ ...f }));
    }
    async function chooseDedicatedFolder(folder) {
      fileAccess();
      if (!dedicated.has(folder)) return fail('confirmation');
      const lease = epoch, account = await provider.account();
      if (lease !== epoch || account !== approvedAccount) return fail('auth');
      await provider.folder(folder);
      if (lease !== epoch || Date.now() >= until) return fail('auth');
      const binding = [...new Uint8Array(await host.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([cfg.clientId, account, folder]))))].map(x => x.toString(16).padStart(2, '0')).join('');
      if (lease !== epoch || Date.now() >= until) return fail('auth');
      return { folder, binding, account: identity.label };
    }
    function chooseFolder() {
      if (pickReject) return Promise.reject(Object.assign(new Error('busy'), { code: 'busy' }));
      if (!token || Date.now() >= until) { disconnect(); return Promise.reject(Object.assign(new Error('auth'), { code: 'auth' })); }
      try { fileAccess(); } catch (e) { return Promise.reject(e); }
      const lease = epoch;
      return new Promise((resolve, reject) => {
        pickReject = reject;
        const gp = host.google.picker;
        const view = new gp.DocsView(gp.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
        picker = new gp.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId)
          .setOrigin(host.location.origin).setCallback(async data => {
            if (lease !== epoch || pickReject !== reject || pickerBusy) return;
            if (data.action === gp.Action.CANCEL) { picker = null; pickReject = null; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }
            if (data.action !== gp.Action.PICKED) return;
            picker = null; pickerBusy = true;
            try {
              if (lease !== epoch || Date.now() >= until || data.docs?.length !== 1) return fail('auth');
              const account = await provider.account();
              if (lease !== epoch || account !== approvedAccount) return fail('auth');
              const folder = data.docs[0].id; await provider.folder(folder);
              if (lease !== epoch || Date.now() >= until) return fail('auth');
              const binding = [...new Uint8Array(await host.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([cfg.clientId, account, folder]))))].map(x => x.toString(16).padStart(2, '0')).join('');
              if (lease !== epoch) return fail('auth');
              pickReject = null; pickerBusy = false; resolve({ folder, binding, account: identity.label }); // identifiants jamais consignés ni placés dans une URL de l'application
            } catch (e) { if (pickReject === reject) { pickReject = null; pickerBusy = false; } reject(e); }
          }).build();
        picker.setVisible(true);
      });
    }
    return Object.freeze({ prepare, connect, confirmAccount, newFolder, listDedicatedFolders, chooseDedicatedFolder, chooseFolder, disconnect,
      get identity() { return identity && { ...identity }; }, get confirmed() { return !!approvedAccount; },
      get connected() { if (token && (Date.now() >= until || provider.connected === false)) disconnect(); return !!token; } });
  }
  return Object.freeze({ SCOPE, config, load, create });
})();

export { GoogleDriveSession };
