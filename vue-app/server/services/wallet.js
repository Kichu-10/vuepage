import { decideTransaction, reservedWithdrawalCents, toCents } from "../database.js";

export function getAvailableBalanceCents(balance, userId) {
  return toCents(balance) - reservedWithdrawalCents(userId);
}

export function canReserveWithdrawal(balance, userId, amount) {
  return getAvailableBalanceCents(balance, userId) >= toCents(amount);
}

export function approveTransaction(transactionId, adminUsername) {
  return decideTransaction({ transactionId, status: "approved", adminUsername });
}
