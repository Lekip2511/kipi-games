// Kipi Games — Auth y fichas 100% cliente (sin backend)
window.KipiAuth = (function () {
  let _user = null;
  let _onUserChange = null;

  // ====== Helpers localStorage ======
  function storageKey(googleId, suffix) {
    return `kipi_${googleId}_${suffix}`;
  }

  function getChipsLocal(googleId) {
    const v = localStorage.getItem(storageKey(googleId, 'chips'));
    return v === null ? 1000 : parseInt(v);
  }

  function setChipsLocal(googleId, chips) {
    localStorage.setItem(storageKey(googleId, 'chips'), chips.toString());
  }

  function getBonusLocal(googleId) {
    return localStorage.getItem(storageKey(googleId, 'bonus')) || '';
  }

  function setBonusLocal(googleId, date) {
    localStorage.setItem(storageKey(googleId, 'bonus'), date);
  }

  // Decodificar JWT de Google (solo payload, sin verificar firma)
  function decodeJwtPayload(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64));
    } catch (e) { return null; }
  }

  // ====== API pública (misma interfaz que antes) ======
  function getUser() { return _user; }
  function onUserChange(cb) { _onUserChange = cb; }

  async function fetchMe() {
    const stored = localStorage.getItem('kipi_session');
    if (!stored) return null;
    try {
      const session = JSON.parse(stored);
      if (Date.now() - session.ts > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem('kipi_session');
        return null;
      }
      _user = {
        id: session.sub,
        name: session.name,
        email: session.email,
        avatar: session.avatar,
        chips: getChipsLocal(session.sub),
        lastDailyBonus: getBonusLocal(session.sub)
      };
      if (_onUserChange) _onUserChange(_user);
      return _user;
    } catch (e) {
      localStorage.removeItem('kipi_session');
      return null;
    }
  }

  async function spendChips(amount) {
    if (!_user) throw new Error('No autenticado');
    const chips = getChipsLocal(_user.id);
    if (chips < amount) throw new Error('Fichas insuficientes');
    const newChips = chips - amount;
    setChipsLocal(_user.id, newChips);
    _user.chips = newChips;
    if (_onUserChange) _onUserChange(_user);
    return { success: true, chips: newChips };
  }

  async function winChips(amount) {
    if (!_user) throw new Error('No autenticado');
    const chips = getChipsLocal(_user.id);
    const newChips = chips + amount;
    setChipsLocal(_user.id, newChips);
    _user.chips = newChips;
    if (_onUserChange) _onUserChange(_user);
    return { success: true, chips: newChips };
  }

  async function claimDailyBonus() {
    if (!_user) throw new Error('No autenticado');
    const now = new Date();
    const hour = now.getHours();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (hour < 13) {
      const minsLeft = (13 - hour) * 60 - now.getMinutes();
      const hoursLeft = Math.floor(minsLeft / 60);
      const minsRemaining = minsLeft % 60;
      throw new Error(`El bono diario estar\u00e1 disponible en ${hoursLeft}h ${minsRemaining}min`);
    }

    const lastBonus = getBonusLocal(_user.id);
    if (lastBonus === today) throw new Error('Ya has reclamado tu bono hoy');

    const chips = getChipsLocal(_user.id);
    const newChips = chips + 1000;
    setChipsLocal(_user.id, newChips);
    setBonusLocal(_user.id, today);
    _user.chips = newChips;
    _user.lastDailyBonus = today;
    if (_onUserChange) _onUserChange(_user);
    return { success: true, chips: newChips, added: 1000 };
  }

  function logout() {
    localStorage.removeItem('kipi_session');
    _user = null;
    if (_onUserChange) _onUserChange(null);
  }

  // ====== Google Sign-In ======
  async function initGoogleSignIn(buttonId, onSuccess) {
    // Restaurar sesión previa
    const existing = await fetchMe();
    if (existing) {
      if (onSuccess) onSuccess(existing);
      updateButtonToLoggedIn(buttonId);
      return;
    }

    // Obtener client ID del endpoint /api/config (solo si existe el backend)
    let clientId = '';
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const config = await res.json();
        clientId = config.googleClientId || '';
      }
    } catch (e) {
      // Sin backend, usar client ID hardcodeado para Netlify
      clientId = '116466179084-pv098dj9cj215eu8aaa93guu53dlpneo.apps.googleusercontent.com';
    }

    if (!clientId) {
      const btn = document.getElementById(buttonId);
      if (btn) btn.innerHTML = '<span style="color:#d4af37;opacity:0.5">Google Sign-In no configurado</span>';
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          const payload = decodeJwtPayload(response.credential);
          if (!payload) { alert('Error al procesar login'); return; }

          const id = payload.sub;
          const name = payload.name || payload.email.split('@')[0];
          const email = payload.email;
          const avatar = payload.picture || '';

          _user = {
            id,
            name,
            email,
            avatar,
            chips: getChipsLocal(id),
            lastDailyBonus: getBonusLocal(id)
          };

          localStorage.setItem('kipi_session', JSON.stringify({
            sub: id,
            name,
            email,
            avatar,
            ts: Date.now()
          }));

          updateButtonToLoggedIn(buttonId);
          if (_onUserChange) _onUserChange(_user);
          if (onSuccess) onSuccess(_user);
        },
        auto_select: false,
        cancel_on_tap_outside: true
      });

      renderCustomButton(buttonId);
    };
    document.head.appendChild(script);
  }

  function updateButtonToLoggedIn(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn || !_user) return;
    btn.innerHTML = '';
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:10px;font-family:Montserrat,sans-serif;font-size:12px;color:#e0d8c8;';
    el.innerHTML = `<img src="${_user.avatar || 'icono.png'}" style="width:28px;height:28px;border-radius:50%;border:2px solid rgba(212,175,55,0.4)"><span>${_user.name}</span>`;
    btn.appendChild(el);
  }

  function renderCustomButton(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    btn.innerHTML = '';
    btn.style.cssText = 'display:inline-block;';

    // Crear wrapper premium alrededor del botón de Google
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display:inline-block;position:relative;
      padding:2px;border-radius:50px;
      background:linear-gradient(180deg,rgba(212,175,55,0.3),rgba(212,175,55,0.08));
      transition:all 0.3s ease;
    `;
    wrapper.addEventListener('mouseenter', () => {
      wrapper.style.transform = 'translateY(-2px)';
      wrapper.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5),0 0 20px rgba(212,175,55,0.12)';
    });
    wrapper.addEventListener('mouseleave', () => {
      wrapper.style.transform = '';
      wrapper.style.boxShadow = '';
    });

    btn.appendChild(wrapper);

    // Renderizar botón oficial de Google (más fiable que prompt)
    google.accounts.id.renderButton(wrapper, {
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      width: 260
    });
  }

  return {
    fetchMe, spendChips, winChips, claimDailyBonus,
    getUser, onUserChange, logout, initGoogleSignIn
  };
})();
