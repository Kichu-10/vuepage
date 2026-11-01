<template>
  <main v-if="!signedIn" class="admin-login">
    <form class="login-card" @submit.prevent="login">
      <img src="/src/assets/brand-logo.jpg" alt="B9 Game" />
      <h1>Admin Portal</h1>
      <p>Authorized access only</p>
      <input v-model="username" autocomplete="username" placeholder="Admin username" required />
      <input v-model="password" type="password" autocomplete="current-password" placeholder="Password" required />
      <button type="submit" :disabled="loading">{{ loading ? "Signing in..." : "Sign In" }}</button>
      <small v-if="error">{{ error }}</small>
    </form>
  </main>

  <main v-else class="admin-shell">
    <header>
      <div><strong>B9 Game</strong><span>Admin Control</span></div>
      <button @click="logout">Sign Out</button>
    </header>
    <section class="stats">
      <article><strong>{{ stats.totalUsers }}</strong><span>Total Users</span></article>
      <article><strong>{{ stats.activeUsers }}</strong><span>Active Users</span></article>
      <article><strong>Rs. {{ money(stats.totalBalance) }}</strong><span>User Balance</span></article>
      <article><strong>{{ stats.pendingRequests }}</strong><span>Pending Requests</span></article>
    </section>

    <nav>
      <button :class="{ active: tab === 'users' }" @click="tab = 'users'">Users</button>
      <button :class="{ active: tab === 'kyc' }" @click="tab = 'kyc'">KYC</button>
      <button :class="{ active: tab === 'transactions' }" @click="tab = 'transactions'">Transactions</button>
    </nav>

    <section v-if="tab === 'users'" class="panel">
      <h2>Users</h2>
      <article v-for="account in users" :key="account.id" class="row">
        <div><strong>{{ account.username }}</strong><span>{{ account.email }} · {{ account.country === "NP" ? "Nepal" : account.country === "IN" ? "India" : "Country not set" }}</span></div>
        <div class="meta">Rs. {{ money(account.balance) }} · {{ account.status }}</div>
        <button @click="toggleUser(account)">{{ account.status === "active" ? "Suspend" : "Activate" }}</button>
      </article>
    </section>

    <section v-if="tab === 'kyc'" class="panel">
      <h2>KYC Verification</h2>
      <article v-for="account in kycUsers" :key="account.id" class="kyc-row">
        <div>
          <strong>{{ account.fullName || account.username }}</strong>
          <span>{{ account.country === "NP" ? "Nepal" : "India" }} · {{ account.documentType }} · {{ account.documentNumber }}</span>
          <span>Status: {{ account.kycStatus }}</span>
        </div>
        <div class="documents" v-if="account.kycDocuments">
          <button v-if="account.kycDocuments.front" @click="openDocument(account.kycDocuments.front)">Front</button>
          <button v-if="account.kycDocuments.back" @click="openDocument(account.kycDocuments.back)">Back</button>
          <button v-if="account.kycDocuments.selfie" @click="openDocument(account.kycDocuments.selfie)">Selfie</button>
        </div>
        <div v-if="account.kycStatus === 'pending'" class="actions">
          <button @click="reviewKyc(account.id, 'verified')">Verify</button>
          <button class="reject" @click="reviewKyc(account.id, 'rejected')">Reject</button>
        </div>
      </article>
      <p v-if="kycUsers.length === 0" class="empty">No KYC submissions</p>
    </section>

    <section v-if="tab === 'transactions'" class="panel">
      <h2>Transactions</h2>
      <article v-for="item in transactions" :key="item.id" class="row">
        <div><strong>{{ item.username }}</strong><span>{{ item.type }} · Rs. {{ money(item.amount) }}</span></div>
        <div :class="item.status">{{ item.status }}</div>
        <div v-if="item.status === 'pending'" class="actions">
          <button @click="processTransaction(item.id, 'approved')">Approve</button>
          <button class="reject" @click="processTransaction(item.id, 'rejected')">Reject</button>
        </div>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

type Account = {
  id: string; username: string; email: string; phone: string; country: string; balance: number; status: string;
  fullName: string; documentType: string; documentNumber: string; kycStatus: string; kycDocuments: Record<string, string>;
};
type Transaction = { id: string; username: string; type: string; amount: number; status: string };

const token = ref(localStorage.getItem("b9_admin_token") || "");
const signedIn = ref(Boolean(token.value));
const username = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const tab = ref<"users" | "kyc" | "transactions">("users");
const stats = ref({ totalUsers: 0, activeUsers: 0, totalBalance: 0, pendingRequests: 0 });
const users = ref<Account[]>([]);
const transactions = ref<Transaction[]>([]);
const kycUsers = computed(() => users.value.filter((account) => account.kycStatus !== "not_submitted"));

async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (token.value) headers.set("Authorization", `Bearer ${token.value}`);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function login() {
  loading.value = true;
  error.value = "";
  try {
    const data = await api("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    token.value = data.token;
    localStorage.setItem("b9_admin_token", data.token);
    signedIn.value = true;
    password.value = "";
    await refresh();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Login failed";
  } finally {
    loading.value = false;
  }
}

function logout() {
  token.value = "";
  localStorage.removeItem("b9_admin_token");
  signedIn.value = false;
}

async function refresh() {
  try {
    const [statsData, usersData, transactionsData] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/users"),
      api("/api/admin/transactions"),
    ]);
    stats.value = statsData;
    users.value = usersData.users;
    transactions.value = transactionsData.transactions;
  } catch {
    logout();
  }
}

async function toggleUser(account: Account) {
  await api(`/api/admin/users/${account.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: account.status === "active" ? "suspended" : "active" }),
  });
  await refresh();
}

async function processTransaction(id: string, status: "approved" | "rejected") {
  await api(`/api/admin/transactions/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  await refresh();
}

async function reviewKyc(id: string, status: "verified" | "rejected") {
  await api(`/api/admin/users/${id}/kyc`, { method: "PATCH", body: JSON.stringify({ status }) });
  await refresh();
}

async function openDocument(url: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token.value}` } });
  if (!response.ok) return;
  const blob = await response.blob();
  window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
}

function money(value: number) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

if (signedIn.value) refresh();
</script>

<style>
:root { font-family: Inter, system-ui, sans-serif; color: #27382b; background: #edf4ef; }
* { box-sizing: border-box; }
body { margin: 0; }
.admin-login { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
.login-card { width: min(380px, 100%); display: flex; flex-direction: column; gap: 12px; padding: 28px; border-radius: 18px; background: white; box-shadow: 0 12px 40px rgb(20 60 34 / 12%); }
.login-card img { width: 54px; height: 54px; object-fit: cover; border-radius: 10px; }
.login-card h1 { margin: 4px 0 0; }
.login-card p { margin: 0 0 4px; color: #718076; }
.login-card input { height: 46px; padding: 0 12px; border: 1px solid #d5ded6; border-radius: 10px; outline-color: #20a85a; }
.login-card button { height: 46px; border: 0; border-radius: 10px; color: white; background: #159a4b; font-weight: 750; }
.login-card small { color: #b54a4a; }
.admin-shell { min-height: 100vh; max-width: 1100px; margin: 0 auto; padding: 18px; }
.admin-shell header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.admin-shell header div { display: flex; flex-direction: column; }
.admin-shell header span { color: #718076; font-size: 12px; }
.admin-shell header button { padding: 9px 13px; border: 0; border-radius: 9px; color: white; background: #315940; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.stats article { display: flex; min-height: 92px; flex-direction: column; justify-content: center; padding: 14px; border-radius: 13px; background: white; box-shadow: 0 4px 16px rgb(20 60 34 / 6%); }
.stats strong { font-size: 22px; }
.stats span { margin-top: 4px; color: #718076; font-size: 12px; }
.admin-shell nav { display: flex; gap: 7px; margin: 16px 0 10px; }
.admin-shell nav button { padding: 9px 14px; border: 0; border-radius: 9px; color: #59665d; background: white; }
.admin-shell nav button.active { color: white; background: #159a4b; }
.panel { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 14px; background: white; }
.panel h2 { margin: 0 0 5px; font-size: 17px; }
.row, .kyc-row { display: flex; min-height: 58px; align-items: center; gap: 10px; padding: 9px; border-radius: 10px; background: #f4f7f4; }
.row > div:first-child, .kyc-row > div:first-child { min-width: 0; flex: 1; }
.row strong, .row span, .kyc-row strong, .kyc-row span { display: block; }
.row span, .kyc-row span { margin-top: 2px; color: #718076; font-size: 11px; }
.meta { color: #536358; font-size: 12px; }
.row button, .kyc-row button, .documents button { padding: 8px 10px; border: 0; border-radius: 8px; color: white; background: #159a4b; cursor: pointer; }
.actions { display: flex; gap: 5px; }
.actions .reject { background: #b85b5b; }
.documents { display: flex; gap: 5px; }
.pending { color: #b47b20; } .approved, .verified { color: #23834a; } .rejected { color: #b85b5b; }
.pending, .approved, .rejected, .verified { font-size: 12px; text-transform: capitalize; }
.empty { color: #718076; text-align: center; }
@media (max-width: 700px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .row, .kyc-row { align-items: flex-start; flex-wrap: wrap; }
}
</style>
