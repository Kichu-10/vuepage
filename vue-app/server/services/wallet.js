import { changeBalance, reservedWithdrawalCents, toCents } from "../database.js";

export function getAvailableBalanceCents(userBalance, userId) {
  return toCents(userBalance) - reservedWithdrawalCents(userId);
}

export function reserveIsValid(user, amount, transactions) {
  const reserved = transactions
    .filter((item) => item.userId === user.id && item.type === "withdrawal" && item.status === "pending")
    .reduce((sum, item) => sum + toCents(item.amount), 0);
  return toCents(user.balance) - reserved >= toCents(amount);
}

export function approveTransaction(db, transaction, adminUsername) {
  if (transaction.status !== "pending") throw new Error("Request already processed");
  const user = db.users.find((item) => item.id === transaction.userId);
  if (!user) throw new Error("User not found");

  if (transaction.type === "withdrawal" && toCents(user.balance) < toCents(transaction.amount)) {
    throw new Error("Insufficient balance to approve this withdrawal");
  }

  transaction.status = "approved";
  transaction.processedAt = new Date().toISOString();
  changeBalance({
    userId: user.id,
    amount: transaction.amount,
    type: transaction.type === "deposit" ? "credit" : "debit",
    transactionId: transaction.id,
    reference: transaction.paymentReference || transaction.id,
  });
  return { transaction, balance: changeBalanceBalance(db, user.id) };
}

function changeBalanceBalance(db, userId) {
  return db.users.find((item) => item.id === userId)?.balance || 0;
}
