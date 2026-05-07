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

    const customBtn = document.createElement('button');
    customBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:10px;">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Iniciar sesión con Google
    `;
    customBtn.style.cssText = `
      display:inline-flex;align-items:center;justify-content:center;
      padding:12px 28px;font-family:'Montserrat',sans-serif;font-size:14px;font-weight:700;
      color:#e0d8c8;background:linear-gradient(180deg,rgba(30,30,30,0.95),rgba(16,16,16,0.98));
      border:1px solid rgba(212,175,55,0.35);border-radius:50px;cursor:pointer;
      letter-spacing:1px;transition:all 0.3s cubic-bezier(0.175,0.885,0.32,1.2);
      box-shadow:0 4px 0 rgba(0,0,0,0.5),0 6px 20px rgba(0,0,0,0.4);
      max-width:300px;
    `;
    customBtn.addEventListener('mouseenter', () => {
      customBtn.style.transform = 'translateY(-2px)';
      customBtn.style.borderColor = 'rgba(212,175,55,0.6)';
      customBtn.style.boxShadow = '0 6px 0 rgba(0,0,0,0.5),0 8px 25px rgba(0,0,0,0.5),0 0 20px rgba(212,175,55,0.1)';
    });
    customBtn.addEventListener('mouseleave', () => {
      customBtn.style.transform = '';
      customBtn.style.borderColor = 'rgba(212,175,55,0.35)';
      customBtn.style.boxShadow = '0 4px 0 rgba(0,0,0,0.5),0 6px 20px rgba(0,0,0,0.4)';
    });
    customBtn.addEventListener('mousedown', () => {
      customBtn.style.transform = 'translateY(3px)';
      customBtn.style.boxShadow = '0 1px 0 rgba(0,0,0,0.5),0 3px 8px rgba(0,0,0,0.4)';
    });
    customBtn.addEventListener('click', () => {
      customBtn.disabled = true;
      customBtn.textContent = 'Conectando...';
      google.accounts.id.prompt();
      setTimeout(() => {
        if (customBtn.disabled) {
          customBtn.disabled = false;
          customBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:10px;">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Iniciar sesión con Google
          `;
        }
      }, 3000);
    });
    btn.appendChild(customBtn);
  }

  return {
    fetchMe, spendChips, winChips, claimDailyBonus,
    getUser, onUserChange, logout, initGoogleSignIn
  };
})();
