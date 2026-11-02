<template>
  <main v-if="!signedIn" class="admin-login">
    <div class="login-brand-panel">
      <img src="/src/assets/brand-logo.jpg" alt="B9 Game" />
      <div>
        <span>CONTROL CENTER</span>
        <strong>B9 Game</strong>
      </div>
    </div>
    <form class="login-card" @submit.prevent="login">
      <div class="login-heading">
        <span class="shield-icon">BG</span>
        <div><h1>Welcome back</h1><p>Sign in to your administrator workspace</p></div>
      </div>
      <label>Username<input v-model="username" autocomplete="username" name="admin-username" placeholder="Enter admin username" required /></label>
      <label>Password<input v-model="password" type="password" autocomplete="current-password" name="admin-password" placeholder="Enter password" required /></label>
      <button class="login-button" type="submit" :disabled="loading">{{ loading ? "Authenticating..." : "Sign in securely" }}</button>
      <small v-if="error" class="login-error">{{ error }}</small>
    </form>
  </main>

  <main v-else class="admin-shell">
    <AdminSidebar :tab="tab" :stats="stats" :open-ticket-count="openTicketCount" @select="selectTab" @logout="logout" />

    <section class="workspace">
      <header class="workspace-header">
        <div>
          <span>ADMIN CONTROL CENTER</span>
          <h1>{{ pageTitle }}</h1>
        </div>
        <div class="header-actions">
          <span class="live-status"><i></i> Live</span>
          <span class="refresh-time">Updated {{ lastRefreshTime }}</span>
          <button class="icon-button" title="Refresh data" @click="refresh">↻</button>
        </div>
      </header>

    <section v-if="tab === 'overview'" class="overview-page">
      <div class="stats-grid">
        <article class="stat-card users-card"><div class="stat-icon">♙</div><div><span>Total users</span><strong>{{ stats.totalUsers }}</strong><small>{{ stats.activeUsers }} active</small></div></article>
        <article class="stat-card balance-card"><div class="stat-icon">₨</div><div><span>Total balance</span><strong>Rs. {{ money(stats.totalBalance) }}</strong><small>Across all accounts</small></div></article>
        <article class="stat-card request-card"><div class="stat-icon">↔</div><div><span>Pending requests</span><strong>{{ stats.pendingRequests }}</strong><small>Awaiting review</small></div></article>
        <article class="stat-card kyc-card"><div class="stat-icon">✓</div><div><span>Pending KYC</span><strong>{{ stats.pendingKyc }}</strong><small>Identity reviews</small></div></article>
      </div>

    <section v-if="tab === 'overview'" class="panel overview-panel">
      <h2>Operations Overview</h2>
      <div class="overview-grid">
        <article><span>Deposits pending</span><strong>{{ transactions.filter(item => item.status === 'pending' && item.type === 'deposit').length }}</strong></article>
        <article><span>Withdrawals pending</span><strong>{{ transactions.filter(item => item.status === 'pending' && item.type === 'withdrawal').length }}</strong></article>
        <article><span>KYC awaiting review</span><strong>{{ stats.pendingKyc }}</strong></article>
        <article><span>Approved withdrawals</span><strong>Rs. {{ money(stats.approvedWithdrawals) }}</strong></article>
      </div>
      <div class="quick-actions">
        <button @click="tab = 'kyc'">Review KYC</button>
        <button @click="tab = 'transactions'">Review Payments</button>
        <button @click="tab = 'results'">Record Result</button>
      </div>
    </section>
    </section>

    <section v-if="tab === 'users'" class="panel">
      <h2>Users</h2>
      <div class="toolbar">
        <input v-model="userSearch" type="search" placeholder="Search username or email" aria-label="Search users" />
        <select v-model="countryFilter" aria-label="Filter country">
          <option value="">All countries</option>
          <option value="IN">India</option>
          <option value="PK">Pakistan</option>
        </select>
      </div>
      <article v-for="account in filteredUsers" :key="account.id" class="row">
        <div><strong>{{ account.username }}</strong><span>{{ account.email }} · {{ account.country === "PK" ? "Pakistan" : account.country === "IN" ? "India" : "Country not set" }}</span></div>
        <div class="meta">Rs. {{ money(account.balance) }} · {{ account.status }}</div>
        <button class="secondary" @click="adjustBalance(account)">Adjust Balance</button>
        <button @click="toggleUser(account)">{{ account.status === "active" ? "Suspend" : "Activate" }}</button>
      </article>
    </section>

    <section v-if="tab === 'kyc'" class="panel">
      <h2>KYC Verification</h2>
      <article v-for="account in kycUsers" :key="account.id" class="kyc-row">
        <div>
          <strong>{{ account.fullName || account.username }}</strong>
          <span>{{ account.country === "PK" ? "Pakistan" : account.country === "IN" ? "India" : "Unknown country" }} · {{ account.documentType }} · {{ account.documentNumber }}</span>
          <span>Status: {{ account.kycStatus }}</span>
        </div>
        <div class="documents" v-if="account.kycDocuments">
          <button v-if="account.kycDocuments.front" @click="openDocument(account.kycDocuments.front)">Front</button>
          <button v-if="account.kycDocuments.back" @click="openDocument(account.kycDocuments.back)">Back</button>
          <button v-if="account.kycDocuments.selfie" @click="openDocument(account.kycDocuments.selfie)">Selfie</button>
        </div>
        <div v-if="account.kycStatus === 'pending'" class="actions">
          <button @click="reviewKyc(account.id, 'verified')">Verify</button>
          <button class="reject" @click="rejectKyc(account)">Reject</button>
        </div>
      </article>
      <p v-if="kycUsers.length === 0" class="empty">No KYC submissions</p>
    </section>

    <section v-if="tab === 'transactions'" class="panel">
      <div class="panel-heading"><div><h2>Transactions</h2><p>Deposits and withdrawal requests</p></div><button class="export-button" @click="exportTransactions">Export CSV</button></div>
      <div class="toolbar transaction-toolbar">
        <input v-model="transactionSearch" type="search" placeholder="Search user or reference" aria-label="Search transactions" />
        <select v-model="transactionStatusFilter">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select v-model="transactionTypeFilter">
          <option value="">All types</option>
          <option value="deposit">Deposit</option>
          <option value="withdrawal">Withdrawal</option>
        </select>
      </div>
      <article v-for="item in filteredTransactions" :key="item.id" class="row">
        <div><strong>{{ item.username }}</strong><span>{{ item.type }} · Rs. {{ money(item.amount) }}</span></div>
        <div class="manual-details">
          <span v-if="item.paymentMethod">Method: {{ item.paymentMethod }}</span>
          <span v-if="item.paymentReference">Reference: {{ item.paymentReference }}</span>
          <span v-if="item.paymentNote">Note: {{ item.paymentNote }}</span>
          <button v-if="item.proofFile" class="proof-button" @click="openProof(item.proofFile)">View payment proof</button>
        </div>
        <div :class="item.status">{{ item.status }}</div>
        <div v-if="item.status === 'pending'" class="actions">
          <button @click="processTransaction(item.id, 'approved')">Approve</button>
          <button class="reject" @click="processTransaction(item.id, 'rejected')">Reject</button>
        </div>
      </article>
      <p v-if="filteredTransactions.length === 0" class="empty">No matching transactions</p>
    </section>

    <section v-if="tab === 'results'" class="panel">
      <h2>Record Game Result</h2>
      <form class="result-form" @submit.prevent="recordGameResult">
        <select v-model="resultUserId" required>
          <option value="" disabled>Select user</option>
          <option v-for="account in users" :key="account.id" :value="account.id">{{ account.username }} · Rs. {{ money(account.balance) }}</option>
        </select>
        <select v-model="resultCategory" required>
          <option value="bet">Bet</option>
          <option value="lottery">Lottery</option>
          <option value="game">Game</option>
        </select>
        <input v-model="resultGameName" placeholder="Game or event name" required />
        <select v-model="resultOutcome" required>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
        <input v-model.number="resultAmount" type="number" min="0" step="0.01" placeholder="Winnings amount" required />
        <input v-model="resultReference" placeholder="Provider reference (optional)" />
        <button type="submit" :disabled="resultLoading">{{ resultLoading ? "Recording..." : "Record Result" }}</button>
      </form>
      <small class="form-message">{{ resultMessage }}</small>
    </section>

    <section v-if="tab === 'activity'" class="panel">
      <h2>Administrator Activity</h2>
      <article v-for="log in activityLogs" :key="log.id" class="activity-row">
        <div><strong>{{ log.action.replaceAll("_", " ") }}</strong><span>{{ log.target }} · {{ log.details }}</span></div>
        <time>{{ formatDate(log.createdAt) }}</time>
      </article>
      <p v-if="activityLogs.length === 0" class="empty">No administrator activity yet</p>
    </section>

    <section v-if="tab === 'support'" class="panel">
      <div class="panel-heading"><div><h2>Support Inbox</h2><p>Customer account requests and assistance</p></div></div>
      <article v-for="ticket in supportTickets" :key="ticket.id" class="ticket-row">
        <div class="ticket-copy">
          <strong>{{ ticket.subject }}</strong>
          <span>{{ ticket.username }} · {{ formatDate(ticket.createdAt) }}</span>
          <p>{{ ticket.message }}</p>
        </div>
        <select :value="ticket.status" @change="updateSupportTicket(ticket, ($event.target as HTMLSelectElement).value)">
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
        </select>
        <button @click="replyToSupportTicket(ticket)">Reply</button>
      </article>
      <p v-if="supportTickets.length === 0" class="empty">No support requests</p>
    </section>

    <section v-if="tab === 'settings'" class="panel settings-panel">
      <div class="panel-heading"><div><h2>Platform Settings</h2><p>Public announcement, support, and member offers</p></div></div>
      <form class="settings-form" @submit.prevent="savePlatformSettings">
        <label>Public announcement<textarea v-model="platformSettings.announcement" rows="3" placeholder="Announcement shown on the homepage"></textarea></label>
        <label>Support email<input v-model="platformSettings.supportEmail" type="email" placeholder="support@example.com" /></label>
        <label>Support phone<input v-model="platformSettings.supportPhone" placeholder="+91..." /></label>
        <label>Support hours<input v-model="platformSettings.supportHours" placeholder="24/7" /></label>
        <label class="switch-row"><span><strong>Maintenance mode</strong><small>Display maintenance notice without disabling the API</small></span><input v-model="platformSettings.maintenanceMode" type="checkbox" /></label>
        <section class="promotion-admin-section">
          <div class="promotion-admin-heading">
            <div><h3>Member promotions</h3><p>Only active offers are visible to signed-in users. State eligibility and terms clearly.</p></div>
            <button type="button" class="secondary" :disabled="platformSettings.promotions.length >= 20" @click="addPromotion">Add offer</button>
          </div>
          <article v-for="(promotion, index) in platformSettings.promotions" :key="promotion.id" class="promotion-admin-card">
            <div class="promotion-admin-card-heading">
              <strong>Offer {{ index + 1 }}</strong>
              <button type="button" class="reject" @click="removePromotion(index)">Remove</button>
            </div>
            <label>Title<input v-model="promotion.title" maxlength="100" required placeholder="Offer title" /></label>
            <label>Description<textarea v-model="promotion.description" maxlength="500" rows="2" placeholder="Describe the offer"></textarea></label>
            <label>Reward description<input v-model="promotion.reward" maxlength="160" placeholder="Describe reward (avoid guarantees)" /></label>
            <label>Eligibility and terms<textarea v-model="promotion.terms" maxlength="1000" rows="3" placeholder="Eligibility, restrictions, expiry, and how to ask about the offer"></textarea></label>
            <label class="switch-row"><span><strong>Offer active</strong><small>Show this offer to signed-in users</small></span><input v-model="promotion.active" type="checkbox" /></label>
          </article>
          <p v-if="platformSettings.promotions.length === 0" class="empty">No offers configured. Add an offer to show it to members.</p>
        </section>
        <button class="primary-button" type="submit">Save platform settings</button>
      </form>
      <small class="form-message" role="status">{{ settingsMessage }}</small>
      <p class="google-config-note">Google Sign-In is configured through the server environment variable <code>GOOGLE_CLIENT_ID</code>. Set the matching web client ID in your Google Cloud OAuth client and add your production domain to its authorized JavaScript origins. Restart the API after changing the value.</p>
    </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from "vue";
import { useSessionStore } from "./stores/session";
import AdminSidebar from "./components/AdminSidebar.vue";

type Account = {
  id: string; username: string; email: string; phone: string; country: string; balance: number; status: string;
  fullName: string; documentType: string; documentNumber: string; kycStatus: string; kycDocuments: Record<string, string>;
};
type Transaction = { id: string; username: string; type: string; amount: number; status: string; paymentMethod?: string; paymentReference?: string; paymentNote?: string; proofFile?: string };
type AuditLog = { id: string; action: string; target: string; details: string; createdAt: string };
type SupportTicket = { id: string; username: string; subject: string; message: string; status: string; reply: string; createdAt: string; updatedAt: string };
type Promotion = { id: string; title: string; description: string; reward: string; terms: string; active: boolean };

const session = useSessionStore();
const token = toRef(session, "adminToken");
const signedIn = ref(Boolean(token.value));
const username = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const tab = ref<"overview" | "users" | "kyc" | "transactions" | "results" | "activity" | "support" | "settings">("overview");
const stats = ref({ totalUsers: 0, activeUsers: 0, totalBalance: 0, pendingRequests: 0, indiaUsers: 0, pakistanUsers: 0, pendingKyc: 0, approvedDeposits: 0, approvedWithdrawals: 0 });
const users = ref<Account[]>([]);
const transactions = ref<Transaction[]>([]);
const activityLogs = ref<AuditLog[]>([]);
const userSearch = ref("");
const countryFilter = ref("");
const transactionSearch = ref("");
const transactionStatusFilter = ref("");
const transactionTypeFilter = ref("");
const resultUserId = ref("");
const resultCategory = ref<"bet" | "lottery" | "game">("game");
const resultGameName = ref("");
const resultOutcome = ref<"won" | "lost">("won");
const resultAmount = ref(0);
const resultReference = ref("");
const resultLoading = ref(false);
const resultMessage = ref("");
const lastRefreshTime = ref("just now");
const supportTickets = ref<SupportTicket[]>([]);
const openTicketCount = computed(() => supportTickets.value.filter((ticket) => ticket.status !== "resolved").length);
const platformSettings = ref({ announcement: "", maintenanceMode: false, supportEmail: "", supportPhone: "", supportHours: "24/7", promotions: [] as Promotion[] });
const settingsMessage = ref("");
let refreshTimer: number | undefined;
const kycUsers = computed(() => users.value.filter((account) => account.kycStatus !== "not_submitted"));
const filteredUsers = computed(() => {
  const search = userSearch.value.trim().toLowerCase();
  return users.value.filter((account) => {
    const matchesCountry = !countryFilter.value || account.country === countryFilter.value;
    const matchesSearch = !search || account.username.toLowerCase().includes(search) || account.email.toLowerCase().includes(search);
    return matchesCountry && matchesSearch;
  });
});
const filteredTransactions = computed(() => {
  const search = transactionSearch.value.trim().toLowerCase();
  return transactions.value.filter((item) => {
    const matchesStatus = !transactionStatusFilter.value || item.status === transactionStatusFilter.value;
    const matchesType = !transactionTypeFilter.value || item.type === transactionTypeFilter.value;
    const matchesSearch = !search || item.username.toLowerCase().includes(search) || String(item.paymentReference || "").toLowerCase().includes(search) || item.id.toLowerCase().includes(search);
    return matchesStatus && matchesType && matchesSearch;
  });
});
const pageTitle = computed(() => ({
  overview: "Operations Overview",
  users: "User Management",
  kyc: "KYC Verification",
  transactions: "Transactions",
  results: "Game Results",
  activity: "Administrator Activity",
  support: "Support Inbox",
  settings: "Platform Settings",
}[tab.value]));

function selectTab(value: string) {
  const allowedTabs = ["overview", "users", "kyc", "transactions", "results", "activity", "support", "settings"] as const;
  if (allowedTabs.includes(value as (typeof allowedTabs)[number])) {
    tab.value = value as (typeof allowedTabs)[number];
  }
}

function addPromotion() {
  if (platformSettings.value.promotions.length >= 20) return;
  platformSettings.value.promotions.push({
    id: `promotion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    description: "",
    reward: "",
    terms: "",
    active: true,
  });
}

function removePromotion(index: number) {
  platformSettings.value.promotions.splice(index, 1);
}

async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (token.value) headers.set("Authorization", "Bearer " + token.value);
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
    const [statsData, usersData, transactionsData, activityData, supportData, settingsData] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/users"),
      api("/api/admin/transactions"),
      api("/api/admin/activity"),
      api("/api/admin/support"),
      api("/api/admin/settings"),
    ]);
    stats.value = statsData;
    users.value = usersData.users;
    transactions.value = transactionsData.transactions;
    activityLogs.value = activityData.logs;
    supportTickets.value = supportData.tickets;
    platformSettings.value = { ...platformSettings.value, ...settingsData.settings };
    lastRefreshTime.value = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

async function adjustBalance(account: Account) {
  const input = window.prompt(`Set new wallet balance for ${account.username} (current Rs. ${money(account.balance)}):`, String(account.balance));
  if (input === null) return;
  const balance = Number(input);
  if (!Number.isFinite(balance) || balance < 0) {
    window.alert("Enter a valid balance greater than or equal to zero.");
    return;
  }
  const reason = window.prompt("Adjustment reason:", "Administrator balance correction") || "Manual adjustment";
  await api(`/api/admin/users/${account.id}`, { method: "PATCH", body: JSON.stringify({ balance, reason }) });
  await refresh();
}

async function rejectKyc(account: Account) {
  const note = window.prompt(`Reason for rejecting ${account.username}'s KYC:`, "Document details do not match the submitted information");
  if (note === null) return;
  await reviewKyc(account.id, "rejected", note);
}

async function openProof(filename: string) {
  const response = await fetch(`/uploads/${encodeURIComponent(filename)}`, {
    headers: { Authorization: `Bearer ${token.value}` },
  });
  if (!response.ok) throw new Error("Could not open payment proof");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
}

async function reviewKyc(id: string, status: "verified" | "rejected", note = "") {
  await api(`/api/admin/users/${id}/kyc`, { method: "PATCH", body: JSON.stringify({ status, note }) });
  await refresh();
}

async function recordGameResult() {
  if (!resultUserId.value || !resultGameName.value.trim()) {
    resultMessage.value = "Select a user and enter the game or event name.";
    return;
  }
  if (!Number.isFinite(resultAmount.value) || resultAmount.value < 0) {
    resultMessage.value = "Enter a valid winnings amount.";
    return;
  }
  resultLoading.value = true;
  resultMessage.value = "";
  try {
    await api("/api/admin/game-results", {
      method: "POST",
      body: JSON.stringify({
        userId: resultUserId.value,
        category: resultCategory.value,
        gameName: resultGameName.value.trim(),
        outcome: resultOutcome.value,
        amount: resultAmount.value,
        reference: resultReference.value.trim(),
      }),
    });
    resultMessage.value = "Result recorded and the user's wallet/inbox updated.";
    resultGameName.value = "";
    resultAmount.value = 0;
    resultReference.value = "";
    await refresh();
  } catch (caught) {
    resultMessage.value = caught instanceof Error ? caught.message : "Could not record result";
  } finally {
    resultLoading.value = false;
  }
}

async function openDocument(url: string) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token.value } });
  if (!response.ok) return;
  const blob = await response.blob();
  window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
}

function money(value: number) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatDate(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

async function replyToSupportTicket(ticket: SupportTicket) {
  const reply = window.prompt(`Reply to ${ticket.username}:`, ticket.reply || "");
  if (reply === null) return;
  await api(`/api/admin/support/${ticket.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: ticket.status, reply }),
  });
  await refresh();
}

async function updateSupportTicket(ticket: SupportTicket, status: string) {
  await api(`/api/admin/support/${ticket.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, reply: ticket.reply }),
  });
  await refresh();
}

async function savePlatformSettings() {
  settingsMessage.value = "";
  try {
    await api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(platformSettings.value),
    });
    settingsMessage.value = "Platform settings saved successfully.";
  } catch (caught) {
    settingsMessage.value = caught instanceof Error ? caught.message : "Could not save settings";
  }
}

function exportTransactions() {
  const header = ["ID", "Username", "Type", "Amount", "Status", "Method", "Reference", "Created"];
  const rows = filteredTransactions.value.map((item) => [
    item.id,
    item.username,
    item.type,
    String(item.amount),
    item.status,
    item.paymentMethod || "",
    item.paymentReference || "",
  ]);
  const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `b9-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

onMounted(() => {
  if (signedIn.value) {
    refresh();
    refreshTimer = window.setInterval(refresh, 30000);
  }
});

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
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
.toolbar { display: grid; grid-template-columns: 1fr 180px; gap: 8px; margin-bottom: 4px; }
.toolbar input, .toolbar select { height: 42px; padding: 0 10px; border: 1px solid #d5ded6; border-radius: 9px; background: white; }
.transaction-toolbar { grid-template-columns: 1fr 150px 150px; }
.overview-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.overview-grid article { display: flex; min-height: 86px; flex-direction: column; justify-content: center; padding: 12px; border-radius: 10px; background: #f4f7f4; }
.overview-grid span { color: #718076; font-size: 12px; }
.overview-grid strong { margin-top: 5px; font-size: 18px; }
.quick-actions { display: flex; gap: 8px; margin-top: 12px; }
.quick-actions button, .secondary { background: #315940 !important; }
.result-form { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.result-form input, .result-form select { height: 42px; min-width: 0; padding: 0 10px; border: 1px solid #d5ded6; border-radius: 9px; background: white; }
.result-form button { grid-column: 1 / -1; height: 44px; border: 0; border-radius: 9px; color: white; background: #159a4b; font-weight: 700; }
.form-message { margin-top: 8px; color: #526258; }
.activity-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; border-radius: 10px; background: #f4f7f4; }
.activity-row strong { display: block; font-size: 13px; }
.activity-row span, .activity-row time { margin-top: 3px; color: #718076; font-size: 11px; }
.activity-row time { white-space: nowrap; }
.row, .kyc-row { display: flex; min-height: 58px; align-items: center; gap: 10px; padding: 9px; border-radius: 10px; background: #f4f7f4; }
.row > div:first-child, .kyc-row > div:first-child { min-width: 0; flex: 1; }
.row strong, .row span, .kyc-row strong, .kyc-row span { display: block; }
.row span, .kyc-row span { margin-top: 2px; color: #718076; font-size: 11px; }
.meta { color: #536358; font-size: 12px; }
.row button, .kyc-row button, .documents button { padding: 8px 10px; border: 0; border-radius: 8px; color: white; background: #159a4b; cursor: pointer; }
.actions { display: flex; gap: 5px; }
.actions .reject { background: #b85b5b; }
.manual-details { flex: 1.5; min-width: 180px; }
.manual-details span { overflow-wrap: anywhere; }
.manual-details .proof-button { margin-top: 6px; padding: 6px 8px; font-size: 11px; }
.documents { display: flex; gap: 5px; }
.pending { color: #b47b20; } .approved, .verified { color: #23834a; } .rejected { color: #b85b5b; }
.pending, .approved, .rejected, .verified { font-size: 12px; text-transform: capitalize; }
.empty { color: #718076; text-align: center; }
@media (max-width: 700px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .row, .kyc-row { align-items: flex-start; flex-wrap: wrap; }
  .overview-grid { grid-template-columns: repeat(2, 1fr); }
  .transaction-toolbar, .result-form { grid-template-columns: 1fr; }
  .result-form button { grid-column: auto; }
  .quick-actions { flex-wrap: wrap; }
}

/* Professional control-center presentation */
:root { font-family: Inter, "Segoe UI", system-ui, sans-serif; color: #172033; background: #f3f6f8; }
.admin-login {
  position: relative; min-height: 100vh; display: grid; grid-template-columns: minmax(300px, 0.9fr) minmax(380px, 1.1fr);
  place-items: center; padding: 0; background: radial-gradient(circle at 20% 10%, #eefbf5 0, transparent 35%), #f7faf9;
}
.login-brand-panel { position: absolute; left: 5.5%; top: 7%; display: flex; align-items: center; gap: 12px; }
.login-brand-panel img { width: 46px; height: 46px; border-radius: 12px; object-fit: cover; box-shadow: 0 8px 24px rgb(12 91 57 / 18%); }
.login-brand-panel div { display: flex; flex-direction: column; }
.login-brand-panel span { color: #829087; font-size: 9px; font-weight: 800; letter-spacing: 1.7px; }
.login-brand-panel strong { margin-top: 2px; font-size: 17px; }
.login-card {
  grid-column: 2; width: min(430px, calc(100% - 40px)); gap: 18px; padding: 38px; border: 1px solid rgb(29 68 48 / 8%);
  border-radius: 20px; box-shadow: 0 24px 70px rgb(30 67 48 / 12%);
}
.login-heading { display: flex; align-items: center; gap: 14px; margin-bottom: 5px; }
.shield-icon { width: 48px; height: 48px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 14px; color: white; background: linear-gradient(145deg, #1cc78a, #087b4b); font-weight: 900; }
.login-heading h1 { font-size: 25px; letter-spacing: -0.5px; }
.login-heading p { margin-top: 4px; font-size: 13px; }
.login-card label { display: flex; flex-direction: column; gap: 7px; color: #4b5a51; font-size: 12px; font-weight: 750; }
.login-card input { width: 100%; height: 48px; border: 1px solid #dfe7e2; border-radius: 10px; background: #fbfdfc; }
.login-card input:focus { border-color: #25a66c; box-shadow: 0 0 0 4px rgb(37 166 108 / 9%); outline: none; }
.login-button, .login-card button.login-button { height: 48px; margin-top: 2px; border-radius: 10px; background: linear-gradient(135deg, #12a866, #087b4b); box-shadow: 0 10px 20px rgb(8 123 75 / 16%); }
.login-error { color: #b54a4a !important; }
.admin-shell { width: 100%; max-width: none; min-height: 100vh; display: grid; grid-template-columns: 238px minmax(0, 1fr); margin: 0; padding: 0; background: #f4f7f9; }
.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 24px 16px 16px; border-right: 1px solid #e7edf0; background: #fff; }
.brand { display: flex; align-items: center; gap: 11px; padding: 0 8px 22px; border-bottom: 1px solid #edf1f0; }
.brand img { width: 42px; height: 42px; border-radius: 11px; object-fit: cover; }
.brand div { display: flex; flex-direction: column; }
.brand strong { font-size: 15px; }
.brand span { margin-top: 2px; color: #8a9690; font-size: 11px; }
.side-nav { display: flex; flex-direction: column; gap: 4px; margin: 18px 0; }
.side-nav button { width: 100%; min-height: 45px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 0; border-radius: 10px; color: #66736c; background: transparent; font-size: 13px; font-weight: 650; text-align: left; cursor: pointer; }
.side-nav button > span { width: 22px; color: #98a49e; font-size: 16px; text-align: center; }
.side-nav button b { margin-left: auto; min-width: 21px; height: 21px; display: grid; place-items: center; border-radius: 20px; color: #087b4b; background: #e8f6ef; font-size: 10px; }
.side-nav button.active { color: #087b4b; background: #eaf7f1; box-shadow: inset 3px 0 0 #0da768; }
.side-nav button.active > span { color: #0da768; }
.sidebar-user { display: grid; grid-template-columns: 38px 1fr 28px; align-items: center; gap: 9px; margin-top: auto; padding: 11px 8px; border-top: 1px solid #edf1f0; }
.avatar { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; color: white; background: linear-gradient(145deg, #243d33, #0e9a60); font-size: 11px; font-weight: 800; }
.sidebar-user > div:nth-child(2) { display: flex; flex-direction: column; }
.sidebar-user strong { font-size: 12px; }
.sidebar-user span { margin-top: 3px; color: #89968f; font-size: 10px; }
.sidebar-user span i, .live-status i { width: 7px; height: 7px; display: inline-block; margin-right: 4px; border-radius: 50%; background: #20b96f; }
.sidebar-user button { width: 28px; height: 28px; border: 0; border-radius: 8px; color: #89968f; background: #f2f5f4; }
.workspace { min-width: 0; padding: 0 30px 36px; overflow: hidden; }
.workspace-header { height: 104px; display: flex; align-items: center; justify-content: space-between; margin: 0; border-bottom: 1px solid #e7edf0; }
.workspace-header > div:first-child { display: flex; flex-direction: column; }
.workspace-header > div:first-child > span { color: #9aa6a0; font-size: 9px; font-weight: 850; letter-spacing: 1.5px; }
.workspace-header h1 { margin: 5px 0 0; color: #172033; font-size: 24px; letter-spacing: -0.6px; }
.header-actions { display: flex; align-items: center; gap: 10px; }
.header-actions .live-status { height: 28px; display: flex; align-items: center; padding: 0 9px; border-radius: 20px; color: #5d7568; background: #eaf7ef; font-size: 10px; font-weight: 800; }
.refresh-time { color: #98a49e; font-size: 11px; }
.icon-button { width: 36px; height: 36px; border: 1px solid #e2e8e5 !important; border-radius: 9px !important; color: #65736b !important; background: white !important; cursor: pointer; }
.overview-page { display: block; }
.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 24px; }
.stat-card { min-height: 128px; display: flex; align-items: center; gap: 13px; padding: 18px; border: 1px solid #edf1ef; border-radius: 14px; background: white; box-shadow: 0 7px 24px rgb(38 69 52 / 5%); }
.stat-card .stat-icon { width: 43px; height: 43px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 12px; font-size: 17px; font-weight: 850; }
.users-card .stat-icon { color: #1d8ad8; background: #edf7fd; }
.balance-card .stat-icon { color: #079c5b; background: #eaf8f1; }
.request-card .stat-icon { color: #d68a1e; background: #fff5e7; }
.kyc-card .stat-icon { color: #7357d5; background: #f1edff; }
.stat-card div:last-child { min-width: 0; display: flex; flex-direction: column; }
.stat-card span { color: #89968f; font-size: 11px; }
.stat-card strong { margin: 5px 0 3px; overflow: hidden; color: #1d2934; font-size: clamp(20px, 2vw, 27px); letter-spacing: -0.7px; text-overflow: ellipsis; white-space: nowrap; }
.stat-card small { color: #9aa69f; font-size: 10px; }
.panel, .overview-panel { margin-top: 18px; border: 1px solid #edf1ef; border-radius: 14px; background: white; box-shadow: 0 7px 24px rgb(38 69 52 / 4%); }
.panel { padding: 20px; }
.overview-panel { padding: 20px; }
.panel h2 { font-size: 16px; }
.overview-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.overview-grid article { min-height: 90px; border: 1px solid #eef2f0; background: #fafcfb; }
.quick-actions { margin-top: 14px; }
.quick-actions button { height: 38px; padding: 0 14px; border: 0; border-radius: 9px; color: white; background: #087b4b !important; font-size: 12px; font-weight: 750; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; }
.panel-heading p { margin: 4px 0 0; color: #9aa69f; font-size: 11px; }
.export-button { height: 36px; padding: 0 12px; border: 1px solid #dfe7e2 !important; border-radius: 8px !important; color: #526158 !important; background: white !important; font-size: 11px; }
.toolbar { margin-top: 14px; }
.toolbar input, .toolbar select, .result-form input, .result-form select { border-radius: 8px; border-color: #e4eae7; }
.row, .kyc-row { min-height: 70px; border: 1px solid #edf1ef; background: #fff; }
.row:hover, .kyc-row:hover, .activity-row:hover { border-color: #dfe8e3; background: #fbfdfc; }
.row button, .kyc-row button, .documents button { height: 34px; border-radius: 8px; font-size: 11px; }
.activity-row { border: 1px solid #edf1ef; background: white; }
.result-form { margin-top: 14px; }
.ticket-row { display: grid; grid-template-columns: minmax(0, 1fr) 120px 80px; align-items: center; gap: 10px; padding: 14px; border: 1px solid #edf1ef; border-radius: 12px; background: white; }
.ticket-copy strong { display: block; font-size: 13px; }
.ticket-copy span { display: block; margin-top: 3px; color: #92a098; font-size: 10px; }
.ticket-copy p { margin: 7px 0 0; color: #59665f; font-size: 12px; }
.ticket-row select { height: 38px; border: 1px solid #e1e8e4; border-radius: 8px; background: white; }
.ticket-row button { height: 38px; border: 0; border-radius: 8px; color: white; background: #087b4b; }
.settings-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.settings-form label { display: flex; flex-direction: column; gap: 7px; color: #5a685f; font-size: 12px; font-weight: 750; }
.settings-form label:first-child, .settings-form .switch-row, .settings-form .primary-button { grid-column: 1 / -1; }
.settings-form input, .settings-form textarea { width: 100%; border: 1px solid #e1e8e4; border-radius: 9px; background: white; padding: 10px; font-family: inherit; }
.settings-form input { height: 42px; }
.settings-form textarea { resize: vertical; }
.promotion-admin-section { display: grid; grid-column: 1 / -1; gap: 10px; padding-top: 14px; border-top: 1px solid #e8eeea; }
.promotion-admin-heading, .promotion-admin-card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.promotion-admin-heading h3 { margin: 0; color: #344a3c; font-size: 15px; }
.promotion-admin-heading p { max-width: 520px; margin: 4px 0 0; color: #87948b; font-size: 11px; line-height: 1.5; }
.promotion-admin-card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 12px; border: 1px solid #e7ede9; border-radius: 12px; background: #fbfdfb; }
.promotion-admin-card-heading, .promotion-admin-card label:first-of-type, .promotion-admin-card label:nth-of-type(4), .promotion-admin-card .switch-row { grid-column: 1 / -1; }
.promotion-admin-card-heading { align-items: center; }
.promotion-admin-card label { display: flex; flex-direction: column; gap: 6px; color: #5a685f; font-size: 11px; font-weight: 700; }
.promotion-admin-card input, .promotion-admin-card textarea { width: 100%; padding: 9px; border: 1px solid #e1e8e4; border-radius: 8px; background: white; font: inherit; }
.promotion-admin-card input { min-height: 38px; }
.promotion-admin-card textarea { resize: vertical; }
.promotion-admin-card .switch-row { flex-direction: row; }
.google-config-note { margin: 12px 0 0; color: #77847c; font-size: 11px; line-height: 1.6; }
.google-config-note code { overflow-wrap: anywhere; }
.switch-row { flex-direction: row !important; align-items: center; justify-content: space-between; padding: 12px; border: 1px solid #edf1ef; border-radius: 10px; }
.switch-row span { display: flex; flex-direction: column; }
.switch-row small { margin-top: 3px; color: #98a49e; font-weight: 500; }
.switch-row input { width: 18px !important; height: 18px !important; }
@media (max-width: 980px) {
  .admin-shell { grid-template-columns: 78px minmax(0, 1fr); }
  .sidebar { padding-inline: 10px; }
  .brand { justify-content: center; padding-inline: 0; }
  .brand div, .side-nav button:not(.active) b, .side-nav button { font-size: 0; }
  .brand div, .sidebar-user > div:nth-child(2), .sidebar-user button { display: none; }
  .side-nav button { justify-content: center; padding: 0; font-size: 0; }
  .side-nav button > span { font-size: 16px; }
  .side-nav button b { position: absolute; margin: -24px 0 0 28px; display: grid; font-size: 9px; }
  .sidebar-user { display: flex; justify-content: center; }
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .admin-login { grid-template-columns: 1fr; }
  .login-brand-panel { left: 20px; }
  .login-card { grid-column: 1; width: calc(100% - 32px); padding: 26px 20px; }
  .admin-shell { grid-template-columns: 1fr; }
  .sidebar { position: fixed; z-index: 20; top: auto; bottom: 0; width: 100%; height: 68px; display: block; padding: 7px; border-top: 1px solid #e3eae6; border-right: 0; }
  .brand, .sidebar-user { display: none; }
  .side-nav { height: 54px; display: flex; flex-direction: row; gap: 2px; margin: 0; overflow-x: auto; }
  .side-nav button { min-width: 62px; }
  .side-nav button { height: 54px; min-height: 54px; display: grid; place-items: center; align-content: center; gap: 2px; }
  .side-nav button > span { font-size: 16px; }
  .side-nav button b { display: none; }
  .side-nav button.active { box-shadow: none; }
  .workspace { padding: 0 14px 86px; }
  .workspace-header { height: 82px; }
  .workspace-header h1 { font-size: 20px; }
  .refresh-time { display: none; }
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 14px; }
  .stat-card { min-height: 112px; align-items: flex-start; gap: 9px; padding: 12px; }
  .stat-card .stat-icon { width: 36px; height: 36px; }
  .stat-card strong { font-size: 18px; }
  .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .transaction-toolbar { grid-template-columns: 1fr !important; }
  .workspace { padding: 0 12px calc(84px + env(safe-area-inset-bottom)); }
  .workspace-header { height: 72px; margin-bottom: 0; }
  .workspace-header h1 { font-size: 18px; }
  .workspace-header > div:first-child > span { font-size: 8px; }
  .header-actions { gap: 5px; }
  .header-actions .live-status { padding: 0 7px; }
  .panel { padding: 12px; }
  .toolbar { grid-template-columns: 1fr !important; }
  .toolbar input, .toolbar select { width: 100%; min-width: 0; }
  .row, .kyc-row { width: 100%; align-items: stretch; }
  .row > div, .kyc-row > div { width: 100%; flex-basis: auto; }
  .row .actions, .kyc-row .actions, .row button, .kyc-row button { flex: 1; }
  .manual-details, .documents { width: 100%; min-width: 100%; }
  .documents { flex-wrap: wrap; }
  .documents button { flex: 1; }
  .activity-row { align-items: flex-start; }
  .ticket-row { grid-template-columns: 1fr; }
  .ticket-row select, .ticket-row button { width: 100%; }
  .settings-form { grid-template-columns: 1fr; }
  .settings-form label, .settings-form label:first-child, .settings-form .switch-row, .settings-form .primary-button { grid-column: 1; }
  .promotion-admin-section { grid-column: 1; }
  .promotion-admin-card { grid-template-columns: 1fr; }
  .promotion-admin-card-heading, .promotion-admin-card label:first-of-type, .promotion-admin-card label:nth-of-type(4), .promotion-admin-card .switch-row { grid-column: 1; }
  .quick-actions button { flex: 1; min-width: 120px; }
}
@media (max-width: 420px) {
  .stats-grid { grid-template-columns: 1fr; }
  .overview-grid { grid-template-columns: 1fr; }
  .stat-card { min-height: 92px; align-items: center; }
  .stat-card strong { font-size: 17px; }
  .login-card { padding: 22px 16px; }
  .login-heading { align-items: flex-start; }
  .login-heading h1 { font-size: 21px; }
}
</style>
