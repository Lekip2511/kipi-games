const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'kipi.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      chips INTEGER NOT NULL DEFAULT 1000,
      last_daily_bonus TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function findOrCreateUser(googleId, email, name, avatar) {
  const database = getDb();
  let user = database.prepare('SELECT * FROM users WHERE id = ?').get(googleId);

  if (!user) {
    const result = database.prepare(
      'INSERT INTO users (id, email, name, avatar, chips) VALUES (?, ?, ?, ?, 1000)'
    ).run(googleId, email, name, avatar);
  } else {
    database.prepare(
      'UPDATE users SET email = ?, name = ?, avatar = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(email, name, avatar, googleId);
  }

  return database.prepare('SELECT * FROM users WHERE id = ?').get(googleId);
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getChips(userId) {
  const user = getDb().prepare('SELECT chips FROM users WHERE id = ?').get(userId);
  return user ? user.chips : 0;
}

function spendChips(userId, amount) {
  const database = getDb();
  const user = database.prepare('SELECT chips FROM users WHERE id = ?').get(userId);
  if (!user) return { success: false, chips: 0, error: 'Usuario no encontrado' };
  if (user.chips < amount) return { success: false, chips: user.chips, error: 'Fichas insuficientes' };

  const newChips = user.chips - amount;
  database.prepare('UPDATE users SET chips = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newChips, userId);
  return { success: true, chips: newChips };
}

function addChips(userId, amount) {
  const database = getDb();
  const user = database.prepare('SELECT chips FROM users WHERE id = ?').get(userId);
  if (!user) return { success: false, chips: 0, error: 'Usuario no encontrado' };

  const newChips = user.chips + amount;
  database.prepare('UPDATE users SET chips = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newChips, userId);
  return { success: true, chips: newChips };
}

function claimDailyBonus(userId) {
  const database = getDb();
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { success: false, chips: 0, error: 'Usuario no encontrado' };

  const now = new Date();
  const hour = now.getHours();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Bonus solo a partir de las 13:00 (1 PM)
  if (hour < 13) {
    const minsLeft = (13 - hour) * 60 - now.getMinutes();
    const hoursLeft = Math.floor(minsLeft / 60);
    const minsRemaining = minsLeft % 60;
    return {
      success: false,
      chips: user.chips,
      error: `El bono diario estar\u00e1 disponible en ${hoursLeft}h ${minsRemaining}min`
    };
  }

  // Ya reclamado hoy
  if (user.last_daily_bonus === today) {
    return { success: false, chips: user.chips, error: 'Ya has reclamado tu bono hoy' };
  }

  const newChips = user.chips + 1000;
  database.prepare(
    'UPDATE users SET chips = ?, last_daily_bonus = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(newChips, today, userId);

  return { success: true, chips: newChips, added: 1000 };
}

module.exports = {
  getDb,
  findOrCreateUser,
  getUserById,
  getChips,
  spendChips,
  addChips,
  claimDailyBonus
};
