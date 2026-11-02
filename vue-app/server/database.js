import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const directory = path.dirname(fileURLToPath(import.meta.url));
const sqliteFile = process.env.SQLITE_PATH || path.join(directory, "database.sqlite");
const legacyJsonFile = path.join(directory, "database.json");
fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });

export const db = new DatabaseSync(sqliteFile);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
const previousUserColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
const previousTransactionColumns = db.prepare("PRAGMA table_info(transactions)").all().map((column) => column.name);
if (previousUserColumns.includes("data")) db.exec("ALTER TABLE users RENAME TO users_json_legacy;");
if (previousTransactionColumns.includes("data")) db.exec("ALTER TABLE transactions RENAME TO transactions_json_legacy;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user',
    balance_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
    email_verified INTEGER NOT NULL DEFAULT 0, phone_verified INTEGER NOT NULL DEFAULT 0,
    kyc_status TEXT NOT NULL DEFAULT 'not_submitted', full_name TEXT NOT NULL DEFAULT '',
    date_of_birth TEXT NOT NULL DEFAULT '', document_type TEXT NOT NULL DEFAULT '',
    document_number TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
    google_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
    last_login_at TEXT, kyc_reviewed_at TEXT, kyc_review_note TEXT NOT NULL DEFAULT '',
    failed_admin_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL, payment_method TEXT NOT NULL DEFAULT '',
    payment_reference TEXT NOT NULL DEFAULT '', payment_note TEXT NOT NULL DEFAULT '',
    proof_file TEXT NOT NULL DEFAULT '', game_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '', processed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

  CREATE TABLE IF NOT EXISTS kyc_documents (
    user_id TEXT NOT NULL, kind TEXT NOT NULL, file_path TEXT NOT NULL,
    PRIMARY KEY(user_id, kind), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS otps (
    channel TEXT NOT NULL, destination TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY(channel, destination)
  );
  CREATE TABLE IF NOT EXISTS verifications (
    channel TEXT NOT NULL, destination TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(channel, destination)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
    message TEXT NOT NULL, related_id TEXT NOT NULL DEFAULT '', is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    reply TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, admin_username TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_results (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category TEXT NOT NULL, game_name TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0, reference TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    announcement TEXT NOT NULL DEFAULT '',
    maintenance_mode INTEGER NOT NULL DEFAULT 0,
    support_email TEXT NOT NULL DEFAULT '',
    support_phone TEXT NOT NULL DEFAULT '',
    support_hours TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, transaction_id TEXT,
    type TEXT NOT NULL, amount_cents INTEGER NOT NULL, balance_cents INTEGER NOT NULL,
    reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_transaction ON ledger_entries(transaction_id);
`);

function cents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new TypeError("Money amount must be finite");
  const result = Math.round(amount * 100);
  if (!Number.isSafeInteger(result)) throw new RangeError("Money amount exceeds the supported range");
  return result;
}

function dollars(value) {
  return Number((Number(value) / 100).toFixed(2));
}

function bool(value) {
  return value ? 1 : 0;
}

function rowUser(row) {
  return {
    id: row.id, username: row.username, phone: row.phone, email: row.email, country: row.country,
    passwordHash: row.password_hash, role: row.role, balance: dollars(row.balance_cents), status: row.status,
    emailVerified: Boolean(row.email_verified), phoneVerified: Boolean(row.phone_verified),
    kycStatus: row.kyc_status, fullName: row.full_name, dateOfBirth: row.date_of_birth,
    documentType: row.document_type, documentNumber: row.document_number, address: row.address,
    googleId: row.google_id, createdAt: row.created_at, lastLoginAt: row.last_login_at,
    kycReviewedAt: row.kyc_reviewed_at, kycReviewNote: row.kyc_review_note,
    failedAdminAttempts: row.failed_admin_attempts, lockedUntil: row.locked_until, kycDocuments: {},
  };
}

function rowTransaction(row) {
  return {
    id: row.id, userId: row.user_id, username: row.username, type: row.type,
    amount: dollars(row.amount_cents), status: row.status, paymentMethod: row.payment_method,
    paymentReference: row.payment_reference, paymentNote: row.payment_note, proofFile: row.proof_file,
    gameName: row.game_name, createdAt: row.created_at, processedAt: row.processed_at,
  };
}

function legacyRead() {
  try {
    return JSON.parse(fs.readFileSync(legacyJsonFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Could not read legacy database.json", { cause: error });
  }
}

export function readDb() {
  const result = {
    users: db.prepare("SELECT * FROM users ORDER BY rowid DESC").all().map(rowUser),
    transactions: db.prepare("SELECT * FROM transactions ORDER BY rowid DESC").all().map(rowTransaction),
    otps: db.prepare("SELECT * FROM otps").all().map((row) => ({
      channel: row.channel, destination: row.destination, codeHash: row.code_hash, expiresAt: row.expires_at,
    })),
    notifications: db.prepare("SELECT * FROM notifications ORDER BY rowid DESC").all().map((row) => ({
      id: row.id, userId: row.user_id, type: row.type, title: row.title, message: row.message,
      relatedId: row.related_id, read: Boolean(row.is_read), createdAt: row.created_at,
    })),
    supportTickets: db.prepare("SELECT * FROM support_tickets ORDER BY rowid DESC").all().map((row) => ({
      id: row.id, userId: row.user_id, username: row.username, subject: row.subject,
      message: row.message, status: row.status, reply: row.reply, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    auditLogs: db.prepare("SELECT * FROM audit_logs ORDER BY rowid DESC").all().map((row) => ({
      id: row.id, adminUsername: row.admin_username, action: row.action, target: row.target,
      details: row.details, createdAt: row.created_at,
    })),
    gameResults: db.prepare("SELECT * FROM game_results ORDER BY rowid DESC").all().map((row) => ({
      id: row.id, userId: row.user_id, category: row.category, gameName: row.game_name,
      outcome: row.outcome, amount: dollars(row.amount_cents), reference: row.reference, createdAt: row.created_at,
    })),
    platformSettings: {},
    verifications: {},
  };
  const settings = db.prepare("SELECT * FROM platform_settings WHERE id = 1").get();
  if (settings) {
    result.platformSettings = {
      announcement: settings.announcement,
      maintenanceMode: Boolean(settings.maintenance_mode),
      supportEmail: settings.support_email,
      supportPhone: settings.support_phone,
      supportHours: settings.support_hours,
    };
  }
  for (const row of db.prepare("SELECT * FROM kyc_documents").all()) {
    const user = result.users.find((item) => item.id === row.user_id);
    if (user) user.kycDocuments[row.kind] = row.file_path;
  }
  for (const row of db.prepare("SELECT * FROM verifications").all()) {
    result.verifications[`${row.channel}:${row.destination}`] = Boolean(row.verified);
  }
  return result;
}

export function writeDb(source) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const table of ["kyc_documents", "notifications", "otps", "verifications", "support_tickets", "audit_logs", "game_results", "transactions", "users", "platform_settings"]) {
      db.exec(`DELETE FROM ${table};`);
    }

    const insertUser = db.prepare(`
      INSERT INTO users (id, username, phone, email, country, password_hash, role, balance_cents, status,
        email_verified, phone_verified, kyc_status, full_name, date_of_birth, document_type, document_number,
        address, google_id, created_at, last_login_at, kyc_reviewed_at, kyc_review_note, failed_admin_attempts, locked_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertKycDocument = db.prepare("INSERT INTO kyc_documents (user_id, kind, file_path) VALUES (?, ?, ?)");
    for (const user of source.users || []) {
      insertUser.run(
        String(user.id || ""), String(user.username || ""), String(user.phone || ""), String(user.email || ""),
        String(user.country || ""), String(user.passwordHash || ""), String(user.role || "user"), cents(user.balance || 0),
        String(user.status || "active"), bool(user.emailVerified), bool(user.phoneVerified),
        String(user.kycStatus || "not_submitted"), String(user.fullName || ""), String(user.dateOfBirth || ""),
        String(user.documentType || ""), String(user.documentNumber || ""), String(user.address || ""),
        String(user.googleId || ""), String(user.createdAt || ""), user.lastLoginAt || null,
        user.kycReviewedAt || null, String(user.kycReviewNote || ""), Number(user.failedAdminAttempts || 0),
        Number(user.lockedUntil || 0),
      );
      for (const [kind, filePath] of Object.entries(user.kycDocuments || {})) {
        insertKycDocument.run(String(user.id), kind, String(filePath || ""));
      }
    }

    const insertTransaction = db.prepare(`
      INSERT INTO transactions (id, user_id, username, type, amount_cents, status, payment_method,
        payment_reference, payment_note, proof_file, game_name, created_at, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of source.transactions || []) {
      insertTransaction.run(
        String(item.id || ""), String(item.userId || ""), String(item.username || ""), String(item.type || ""),
        cents(item.amount || 0), String(item.status || "pending"), String(item.paymentMethod || ""),
        String(item.paymentReference || ""), String(item.paymentNote || ""), String(item.proofFile || ""),
        String(item.gameName || ""), String(item.createdAt || ""), item.processedAt || null,
      );
    }

    const insertOtp = db.prepare("INSERT INTO otps (channel, destination, code_hash, expires_at) VALUES (?, ?, ?, ?)");
    for (const item of source.otps || []) insertOtp.run(item.channel, item.destination, item.codeHash, Number(item.expiresAt));
    const insertVerification = db.prepare("INSERT INTO verifications (channel, destination, verified) VALUES (?, ?, ?)");
    for (const [key, verified] of Object.entries(source.verifications || {})) {
      const separator = key.indexOf(":");
      insertVerification.run(key.slice(0, separator), key.slice(separator + 1), bool(verified));
    }
    const insertNotification = db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, message, related_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of source.notifications || []) {
      insertNotification.run(item.id, item.userId, item.type, item.title, item.message, item.relatedId || "", bool(item.read), item.createdAt || "");
    }
    const insertTicket = db.prepare(`
      INSERT INTO support_tickets (id, user_id, username, subject, message, status, reply, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of source.supportTickets || []) {
      insertTicket.run(item.id, item.userId, item.username || "", item.subject, item.message, item.status || "open", item.reply || "", item.createdAt || "", item.updatedAt || "");
    }
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (id, admin_username, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of source.auditLogs || []) {
      insertAudit.run(item.id, item.adminUsername || "", item.action, item.target || "", item.details || "", item.createdAt || "");
    }
    const insertResult = db.prepare(`
      INSERT INTO game_results (id, user_id, category, game_name, outcome, amount_cents, reference, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of source.gameResults || []) {
      insertResult.run(item.id, item.userId, item.category, item.gameName || "", item.outcome, cents(item.amount || 0), item.reference || "", item.createdAt || "");
    }
    const settings = source.platformSettings || {};
    db.prepare(`
      INSERT INTO platform_settings (id, announcement, maintenance_mode, support_email, support_phone, support_hours)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(
      String(settings.announcement || ""),
      bool(settings.maintenanceMode),
      String(settings.supportEmail || ""),
      String(settings.supportPhone || ""),
      String(settings.supportHours || ""),
    );
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function toCents(amount) {
  return cents(amount);
}

export function fromCents(amount) {
  return dollars(amount);
}

export function reservedWithdrawalCents(userId) {
  return db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions
    WHERE user_id = ? AND type = 'withdrawal' AND status = 'pending'
  `).get(userId).total;
}

export function changeBalance({ userId, amount, type, transactionId = null, reference = "" }) {
  if (!["credit", "debit"].includes(type)) throw new TypeError("Balance change type must be credit or debit");
  db.exec("BEGIN IMMEDIATE;");
  try {
    const row = db.prepare("SELECT balance_cents FROM users WHERE id = ?").get(userId);
    if (!row) throw new Error("User not found");
    const delta = cents(amount);
    if (delta <= 0) throw new TypeError("Balance changes must be positive");
    const next = row.balance_cents + (type === "credit" ? delta : -delta);
    if (next < 0) throw new Error("Insufficient balance");
    db.prepare("UPDATE users SET balance_cents = ? WHERE id = ?").run(next, userId);
    db.prepare(`
      INSERT INTO ledger_entries (id, user_id, transaction_id, type, amount_cents, balance_cents, reference, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), userId, transactionId, type, type === "credit" ? delta : -delta, next, reference, new Date().toISOString());
    db.exec("COMMIT;");
    return dollars(next);
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function createWithdrawalRequest(transaction, notification) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const user = db.prepare("SELECT balance_cents, status, kyc_status FROM users WHERE id = ?").get(transaction.userId);
    if (!user || user.status !== "active") throw new Error("Account unavailable");
    if (user.kyc_status !== "verified") throw new Error("Complete KYC verification before requesting a withdrawal");
    const reserved = reservedWithdrawalCents(transaction.userId);
    if (user.balance_cents - reserved < cents(transaction.amount)) throw new Error("Insufficient available balance");
    db.prepare(`
      INSERT INTO transactions (id, user_id, username, type, amount_cents, status, payment_method,
        payment_reference, payment_note, proof_file, game_name, created_at, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(transaction.id, transaction.userId, transaction.username, transaction.type, cents(transaction.amount), "pending",
      transaction.paymentMethod || "", transaction.paymentReference || "", transaction.paymentNote || "",
      transaction.proofFile || "", "", transaction.createdAt);
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, message, related_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(notification.id, notification.userId, notification.type, notification.title, notification.message, notification.relatedId || "", notification.createdAt);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function decideTransaction({ transactionId, status, adminUsername }) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
    if (!row) throw new Error("Request not found");
    if (row.status !== "pending") throw new Error("Request already processed");
    const user = db.prepare("SELECT id, username, balance_cents FROM users WHERE id = ?").get(row.user_id);
    if (!user) throw new Error("User not found");
    let balance = dollars(user.balance_cents);
    if (status === "approved") {
      const delta = row.amount_cents * (row.type === "deposit" ? 1 : -1);
      balance = dollars(user.balance_cents + delta);
      if (balance < 0) throw new Error("Insufficient balance to approve this withdrawal");
      db.prepare("UPDATE users SET balance_cents = ? WHERE id = ?").run(user.balance_cents + delta, user.id);
      db.prepare(`
        INSERT INTO ledger_entries (id, user_id, transaction_id, type, amount_cents, balance_cents, reference, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), user.id, row.id, delta >= 0 ? "credit" : "debit", delta, user.balance_cents + delta, row.payment_reference || row.id, new Date().toISOString());
    }
    const processedAt = new Date().toISOString();
    db.prepare("UPDATE transactions SET status = ?, processed_at = ? WHERE id = ? AND status = 'pending'").run(status, processedAt, row.id);
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, message, related_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(randomUUID(), user.id, row.type, `${row.type === "deposit" ? "Deposit" : "Withdrawal"} ${status}`,
      `Your request for Rs. ${dollars(row.amount_cents).toLocaleString("en-US")} was ${status}.`, row.id, processedAt);
    db.prepare(`
      INSERT INTO audit_logs (id, admin_username, action, target, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), adminUsername, `${row.type.toUpperCase()}_${status.toUpperCase()}`, user.username,
      `Rs. ${dollars(row.amount_cents).toLocaleString("en-US")}`, processedAt);
    db.exec("COMMIT;");
    return { transactionId: row.id, balance };
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function backupSqlite(backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  db.exec("PRAGMA wal_checkpoint(FULL);");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(backupDir, `database-${stamp}.sqlite`);
  fs.copyFileSync(sqliteFile, destination);
  const retention = Math.max(1, Number(process.env.DB_BACKUP_RETENTION || 14));
  const backups = fs.readdirSync(backupDir).filter((name) => /^database-.*\.sqlite$/.test(name)).sort().reverse();
  for (const old of backups.slice(retention)) fs.unlinkSync(path.join(backupDir, old));
  return destination;
}

function migrateLegacyJson() {
  const legacyTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  const hasLegacyRows = legacyTables.includes("users_json_legacy") || legacyTables.includes("transactions_json_legacy");
  if (hasLegacyRows) {
    const users = legacyTables.includes("users_json_legacy")
      ? db.prepare("SELECT data FROM users_json_legacy ORDER BY rowid").all().map((row) => JSON.parse(row.data))
      : [];
    const transactions = legacyTables.includes("transactions_json_legacy")
      ? db.prepare("SELECT data FROM transactions_json_legacy ORDER BY rowid").all().map((row) => JSON.parse(row.data))
      : [];
    const state = {};
    for (const row of db.prepare("SELECT key, value FROM app_state").all()) state[row.key] = JSON.parse(row.value);
    writeDb({ ...state, users, transactions });
    db.exec("DELETE FROM app_state;");
    if (legacyTables.includes("transactions_json_legacy")) db.exec("DROP TABLE transactions_json_legacy;");
    if (legacyTables.includes("users_json_legacy")) db.exec("DROP TABLE users_json_legacy;");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    `);
    return;
  }
  if (db.prepare("SELECT COUNT(*) AS count FROM users").get().count > 0) return;
  const legacy = legacyRead();
  if (legacy) writeDb(legacy);
}

migrateLegacyJson();
