require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'kipi-games-secret-' + Math.random().toString(36).slice(2);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

app.use(cors());
app.use(express.json());

// Servir archivos estaticos
app.use(express.static(__dirname));

// Middleware de autenticacion JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

// GET /api/config — config publica para el frontend
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID
  });
});

// POST /api/auth/google
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Credencial requerida' });
  }

  if (!googleClient) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurado en el servidor' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email.split('@')[0];
    const avatar = payload.picture || '';

    const user = db.findOrCreateUser(googleId, email, name, avatar);

    const token = jwt.sign({ sub: googleId }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        chips: user.chips,
        lastDailyBonus: user.last_daily_bonus
      }
    });
  } catch (err) {
    console.error('Error verificando token de Google:', err.message);
    res.status(401).json({ error: 'Token de Google invalido' });
  }
});

// GET /api/me
app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    chips: user.chips,
    lastDailyBonus: user.last_daily_bonus
  });
});

// POST /api/chips/spend
app.post('/api/chips/spend', authMiddleware, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Cantidad invalida' });

  const result = db.spendChips(req.userId, amount);
  if (result.success) return res.json({ chips: result.chips, success: true });
  return res.status(400).json(result);
});

// POST /api/chips/win
app.post('/api/chips/win', authMiddleware, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Cantidad invalida' });

  const result = db.addChips(req.userId, amount);
  res.json({ chips: result.chips, success: true });
});

// POST /api/daily-bonus
app.post('/api/daily-bonus', authMiddleware, (req, res) => {
  const result = db.claimDailyBonus(req.userId);
  if (result.success) return res.json(result);
  return res.status(400).json(result);
});

app.listen(PORT, () => {
  console.log(`\nKipi Games Server corriendo en http://localhost:${PORT}`);
  console.log(`Desde iPhone: http://172.20.10.13:${PORT}`);
  if (!GOOGLE_CLIENT_ID) {
    console.log('\nAVISO: GOOGLE_CLIENT_ID no configurado.');
    console.log('1. Ve a https://console.cloud.google.com/apis/credentials');
    console.log('2. Crea un OAuth 2.0 Client ID para Web');
    console.log('3. Añade http://localhost:8080 y http://172.20.10.13:8080 como orígenes');
    console.log('4. Copia el Client ID en el archivo .env: GOOGLE_CLIENT_ID=TU_ID');
    console.log('5. Reinicia el servidor\n');
  }
});
