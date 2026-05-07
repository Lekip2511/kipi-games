// Kipi Games — Modulo de autenticacion y API compartido
window.KipiAuth = (function () {
  // Auto-detectar backend: local usa mismo origen, Netlify usa Render
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host.startsWith('127.') || host.startsWith('172.') || host.startsWith('192.168.');
  const API_BASE = isLocal ? '' : 'https://kipi-games.onrender.com';

  let _token = localStorage.getItem('kipi_token');
  let _user = null;
  let _onUserChange = null;

  function token() { return _token; }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (_token) headers['Authorization'] = 'Bearer ' + _token;

    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  }

  function saveToken(t) {
    _token = t;
    localStorage.setItem('kipi_token', t);
  }

  function clearToken() {
    _token = null;
    localStorage.removeItem('kipi_token');
  }

  async function loginWithGoogle(credential) {
    const data = await api('POST', '/api/auth/google', { credential });
    saveToken(data.token);
    _user = data.user;
    if (_onUserChange) _onUserChange(_user);
    return _user;
  }

  function logout() {
    clearToken();
    _user = null;
    if (_onUserChange) _onUserChange(null);
  }

  async function fetchMe() {
    if (!_token) return null;
    try {
      _user = await api('GET', '/api/me');
      if (_onUserChange) _onUserChange(_user);
      return _user;
    } catch (e) {
      clearToken();
      _user = null;
      if (_onUserChange) _onUserChange(null);
      return null;
    }
  }

  async function spendChips(amount) {
    const data = await api('POST', '/api/chips/spend', { amount });
    _user.chips = data.chips;
    if (_onUserChange) _onUserChange(_user);
    return data;
  }

  async function winChips(amount) {
    const data = await api('POST', '/api/chips/win', { amount });
    _user.chips = data.chips;
    if (_onUserChange) _onUserChange(_user);
    return data;
  }

  async function claimDailyBonus() {
    const data = await api('POST', '/api/daily-bonus');
    _user.chips = data.chips;
    _user.lastDailyBonus = new Date().toISOString().slice(0, 10);
    if (_onUserChange) _onUserChange(_user);
    return data;
  }

  function getUser() { return _user; }

  function onUserChange(cb) { _onUserChange = cb; }

  // Inicializar Google Identity Services
  async function initGoogleSignIn(buttonId, onSuccess) {
    // Obtener client ID del servidor
    let clientId = '';
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      clientId = config.googleClientId || '';
    } catch (e) {
      console.warn('No se pudo obtener configuracion del servidor');
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!clientId) {
        console.warn('GOOGLE_CLIENT_ID no configurado');
        const btn = document.getElementById(buttonId);
        if (btn) {
          btn.textContent = 'Google Sign-In no configurado';
          btn.disabled = true;
          btn.style.opacity = '0.5';
        }
        return;
      }

      google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            const user = await loginWithGoogle(response.credential);
            if (onSuccess) onSuccess(user);
          } catch (err) {
            console.error('Error al iniciar sesion:', err);
            alert('Error al iniciar sesion: ' + err.message);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true
      });

      const btn = document.getElementById(buttonId);
      if (btn) {
        google.accounts.id.renderButton(btn, {
          theme: 'filled_black',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          width: 260
        });
      }
    };
    document.head.appendChild(script);
  }

  return {
    token,
    api,
    loginWithGoogle,
    logout,
    fetchMe,
    spendChips,
    winChips,
    claimDailyBonus,
    getUser,
    onUserChange,
    initGoogleSignIn
  };
})();
