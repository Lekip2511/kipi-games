// Kipi Games — Auth OAuth + Backend para fichas sincronizadas
window.KipiAuth = (function () {
  let _user = null;
  let _onUserChange = null;

  const CLIENT_ID = '116466179084-pv098dj9cj215eu8aaa93guu53dlpneo.apps.googleusercontent.com';
  const REDIRECT_URI = window.location.origin + '/';
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname.startsWith('127.') || window.location.hostname.startsWith('172.') || window.location.hostname.startsWith('192.168.')
    ? ''
    : 'https://kipi-games.onrender.com';

  // ====== Helpers localStorage (caché) ======
  function getLocal(key) { try { return localStorage.getItem(key); } catch(e) { return null; } }
  function setLocal(key, val) { try { localStorage.setItem(key, val); } catch(e) {} }
  function removeLocal(key) { try { localStorage.removeItem(key); } catch(e) {} }

  function decodeJwtPayload(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64));
    } catch (e) { return null; }
  }

  // ====== API calls ======
  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const jwt = getLocal('kipi_jwt');
    if (jwt) headers['Authorization'] = 'Bearer ' + jwt;

    const res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  }

  // ====== API pública ======
  function getUser() { return _user; }
  function onUserChange(cb) { _onUserChange = cb; }

  async function fetchMe() {
    const jwt = getLocal('kipi_jwt');
    if (!jwt) return null;

    try {
      const data = await api('GET', '/api/me');
      _user = {
        id: data.id, name: data.name, email: data.email, avatar: data.avatar,
        chips: data.chips, lastDailyBonus: data.lastDailyBonus
      };
      setLocal('kipi_session', JSON.stringify({ sub: data.id, name: data.name, email: data.email, avatar: data.avatar, ts: Date.now() }));
      if (_onUserChange) _onUserChange(_user);
      return _user;
    } catch (e) {
      // Backend caído: intentar caché local
      return fetchFromCache();
    }
  }

  async function fetchFromCache() {
    const stored = getLocal('kipi_session');
    if (!stored) return null;
    try {
      const session = JSON.parse(stored);
      if (Date.now() - session.ts > 30 * 24 * 60 * 60 * 1000) { removeLocal('kipi_session'); return null; }
      // Caché local de fichas
      const cachedChips = getLocal('kipi_cached_chips');
      const cachedBonus = getLocal('kipi_cached_bonus');
      _user = {
        id: session.sub, name: session.name, email: session.email, avatar: session.avatar,
        chips: cachedChips !== null ? parseInt(cachedChips) : 1000,
        lastDailyBonus: cachedBonus || ''
      };
      if (_onUserChange) _onUserChange(_user);
      return _user;
    } catch (e) { return null; }
  }

  async function spendChips(amount) {
    if (!_user) throw new Error('No autenticado');
    try {
      const data = await api('POST', '/api/chips/spend', { amount });
      _user.chips = data.chips;
      setLocal('kipi_cached_chips', data.chips.toString());
      if (_onUserChange) _onUserChange(_user);
      return data;
    } catch (e) {
      // Fallback local
      const local = parseInt(getLocal('kipi_cached_chips') || '0');
      if (local < amount) throw new Error('Fichas insuficientes');
      const newChips = local - amount;
      setLocal('kipi_cached_chips', newChips.toString());
      _user.chips = newChips;
      if (_onUserChange) _onUserChange(_user);
      return { success: true, chips: newChips };
    }
  }

  async function winChips(amount) {
    if (!_user) throw new Error('No autenticado');
    try {
      const data = await api('POST', '/api/chips/win', { amount });
      _user.chips = data.chips;
      setLocal('kipi_cached_chips', data.chips.toString());
      if (_onUserChange) _onUserChange(_user);
      return data;
    } catch (e) {
      const local = parseInt(getLocal('kipi_cached_chips') || '0');
      const newChips = local + amount;
      setLocal('kipi_cached_chips', newChips.toString());
      _user.chips = newChips;
      if (_onUserChange) _onUserChange(_user);
      return { success: true, chips: newChips };
    }
  }

  async function claimDailyBonus() {
    if (!_user) throw new Error('No autenticado');
    try {
      const data = await api('POST', '/api/daily-bonus');
      _user.chips = data.chips;
      _user.lastDailyBonus = new Date().toISOString().slice(0, 10);
      setLocal('kipi_cached_chips', data.chips.toString());
      setLocal('kipi_cached_bonus', _user.lastDailyBonus);
      if (_onUserChange) _onUserChange(_user);
      return data;
    } catch (e) {
      // Local fallback
      const now = new Date();
      const hour = now.getHours();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (hour < 13) throw new Error('Bono disponible a las 13:00');
      const lastBonus = getLocal('kipi_cached_bonus') || '';
      if (lastBonus === today) throw new Error('Ya reclamado hoy');
      const local = parseInt(getLocal('kipi_cached_chips') || '0');
      const newChips = local + 1000;
      setLocal('kipi_cached_chips', newChips.toString());
      setLocal('kipi_cached_bonus', today);
      _user.chips = newChips;
      _user.lastDailyBonus = today;
      if (_onUserChange) _onUserChange(_user);
      return { success: true, chips: newChips, added: 1000 };
    }
  }

  function logout() {
    removeLocal('kipi_jwt');
    removeLocal('kipi_session');
    removeLocal('kipi_cached_chips');
    removeLocal('kipi_cached_bonus');
    _user = null;
    if (_onUserChange) _onUserChange(null);
  }

  // ====== OAuth redirect flow ======
  function startLogin() {
    const nonce = Math.random().toString(36).substring(2, 15);
    setLocal('kipi_oauth_nonce', nonce);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'id_token',
      redirect_uri: REDIRECT_URI,
      scope: 'openid profile email',
      nonce: nonce,
      prompt: 'select_account'
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
  }

  async function handleOAuthCallback() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('id_token')) return false;

    const params = new URLSearchParams(hash.substring(1));
    const idToken = params.get('id_token');
    if (!idToken) return false;

    const storedNonce = getLocal('kipi_oauth_nonce');
    removeLocal('kipi_oauth_nonce');

    const payload = decodeJwtPayload(idToken);
    if (!payload) return false;
    if (storedNonce && payload.nonce !== storedNonce) return false;

    // Limpiar hash de la URL
    window.history.replaceState(null, '', window.location.pathname);

    // Enviar id_token al backend para obtener JWT y datos del usuario
    try {
      const data = await api('POST', '/api/auth/google', { credential: idToken });
      setLocal('kipi_jwt', data.token);
      _user = {
        id: data.user.id, name: data.user.name, email: data.user.email, avatar: data.user.avatar,
        chips: data.user.chips, lastDailyBonus: data.user.lastDailyBonus
      };
      setLocal('kipi_session', JSON.stringify({ sub: data.user.id, name: data.user.name, email: data.user.email, avatar: data.user.avatar, ts: Date.now() }));
      setLocal('kipi_cached_chips', data.user.chips.toString());
      if (_onUserChange) _onUserChange(_user);
      return true;
    } catch (e) {
      // Backend no disponible: usar datos del id_token decodificado
      console.warn('Backend no disponible, usando datos locales:', e.message);
      const id = payload.sub;
      const name = payload.name || payload.email.split('@')[0];
      const email = payload.email;
      const avatar = payload.picture || '';

      _user = {
        id, name, email, avatar,
        chips: parseInt(getLocal('kipi_cached_chips') || '1000'),
        lastDailyBonus: getLocal('kipi_cached_bonus') || ''
      };
      setLocal('kipi_session', JSON.stringify({ sub: id, name, email, avatar, ts: Date.now() }));
      if (_onUserChange) _onUserChange(_user);
      return true;
    }
  }

  // ====== Botón de login ======
  async function initGoogleSignIn(buttonId, onSuccess) {
    const handled = await handleOAuthCallback();
    if (handled) {
      if (onSuccess) onSuccess(_user);
      updateButtonToLoggedIn(buttonId);
      return;
    }

    const existing = await fetchMe();
    if (existing) {
      if (onSuccess) onSuccess(existing);
      updateButtonToLoggedIn(buttonId);
      return;
    }

    renderLoginButton(buttonId);
  }

  function updateButtonToLoggedIn(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn || !_user) return;
    btn.innerHTML = '';
    btn.style.cssText = 'display:inline-block;';
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 16px;font-family:Montserrat,sans-serif;font-size:13px;color:#e0d8c8;background:rgba(25,25,25,0.7);border:1px solid rgba(212,175,55,0.2);border-radius:50px;';
    el.innerHTML = `<img src="${_user.avatar || 'icono.png'}" style="width:28px;height:28px;border-radius:50%;border:2px solid rgba(212,175,55,0.4);object-fit:cover" onerror="this.src='icono.png'"><span style="font-weight:600">${_user.name}</span>`;
    btn.appendChild(el);
  }

  function renderLoginButton(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.innerHTML = '';
    btn.style.cssText = 'display:inline-block;';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:inline-block;position:relative;padding:2px;border-radius:50px;background:linear-gradient(180deg,rgba(212,175,55,0.3),rgba(212,175,55,0.08));transition:all 0.3s ease;';

    const button = document.createElement('button');
    button.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:10px;"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Iniciar sesión con Google`;
    button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;padding:10px 26px;font-family:Montserrat,sans-serif;font-size:14px;font-weight:700;color:#e0d8c8;background:linear-gradient(180deg,rgba(30,30,30,0.95),rgba(16,16,16,0.98));border:none;border-radius:50px;cursor:pointer;letter-spacing:1px;transition:all 0.3s cubic-bezier(0.175,0.885,0.32,1.2);outline:none;';

    wrapper.addEventListener('mouseenter', () => { wrapper.style.transform = 'translateY(-2px)'; wrapper.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5),0 0 20px rgba(212,175,55,0.12)'; });
    wrapper.addEventListener('mouseleave', () => { wrapper.style.transform = ''; wrapper.style.boxShadow = ''; });
    button.addEventListener('click', () => { button.textContent = 'Redirigiendo...'; button.disabled = true; startLogin(); });
    wrapper.appendChild(button);
    btn.appendChild(wrapper);
  }

  return {
    fetchMe, spendChips, winChips, claimDailyBonus,
    getUser, onUserChange, logout, initGoogleSignIn
  };
})();
