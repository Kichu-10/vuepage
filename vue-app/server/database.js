import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqliteFile = path.join(__dirname, "database.sqlite");
const legacyJsonFile = path.join(__dirname, "database.json");

const db = new DatabaseSync(sqliteFile);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    balance REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function emptyDb() {
  return {
    users: [],
    transactions: [],
    otps: [],
    notifications: [],
    supportTickets: [],
    auditLogs: [],
    gameResults: [],
    platformSettings: {},
  };
}

function migrateLegacyJson() {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const transactionCount = db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count;
  if (userCount || transactionCount || !fs.existsSync(legacyJsonFile)) return;

  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyJsonFile, "utf8"));
  } catch {
    legacy = emptyDb();
  }
  writeDb(legacy);
}

export function readDb() {
  const users = db.prepare("SELECT data FROM users ORDER BY rowid DESC").all().map((row) => JSON.parse(row.data));
  const transactions = db.prepare("SELECT data FROM transactions ORDER BY rowid DESC").all().map((row) => JSON.parse(row.data));
  const result = emptyDb();
  result.users = users;
  result.transactions = transactions;

  for (const row of db.prepare("SELECT key, value FROM app_state").all()) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result;
}

export function writeDb(source) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare("DELETE FROM users").run();
    db.prepare("DELETE FROM transactions").run();
    db.prepare("DELETE FROM app_state").run();

    const insertUser = db.prepare(`
      INSERT INTO users (id, username, role, balance, status, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const user of source.users || []) {
      insertUser.run(
        String(user.id || ""),
        String(user.username || ""),
        String(user.role || "user"),
        Number(user.balance || 0),
        String(user.status || "active"),
        JSON.stringify(user),
      );
    }

    const insertTransaction = db.prepare(`
      INSERT INTO transactions (id, user_id, username, type, amount, status, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const transaction of source.transactions || []) {
      insertTransaction.run(
        String(transaction.id || ""),
        String(transaction.userId || ""),
        String(transaction.username || ""),
        String(transaction.type || ""),
        Number(transaction.amount || 0),
        String(transaction.status || "pending"),
        JSON.stringify(transaction),
      );
    }

    const insertState = db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(source)) {
      if (key === "users" || key === "transactions") continue;
      insertState.run(key, JSON.stringify(value));
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

migrateLegacyJson();
