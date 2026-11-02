<template>
  <aside class="sidebar">
    <div class="brand">
      <img src="/src/assets/brand-logo.jpg" alt="" />
      <div><strong>B9 Game</strong><span>Admin Control</span></div>
    </div>
    <nav class="side-nav" aria-label="Admin navigation">
      <button :class="{ active: tab === 'overview' }" @click="$emit('select', 'overview')"><span>▦</span>Overview</button>
      <button :class="{ active: tab === 'users' }" @click="$emit('select', 'users')"><span>♙</span>Users <b>{{ stats.totalUsers }}</b></button>
      <button :class="{ active: tab === 'kyc' }" @click="$emit('select', 'kyc')"><span>✓</span>KYC Review <b v-if="stats.pendingKyc">{{ stats.pendingKyc }}</b></button>
      <button :class="{ active: tab === 'transactions' }" @click="$emit('select', 'transactions')"><span>↔</span>Transactions <b v-if="stats.pendingRequests">{{ stats.pendingRequests }}</b></button>
      <button :class="{ active: tab === 'results' }" @click="$emit('select', 'results')"><span>★</span>Game Results</button>
      <button :class="{ active: tab === 'activity' }" @click="$emit('select', 'activity')"><span>◷</span>Activity</button>
      <button :class="{ active: tab === 'support' }" @click="$emit('select', 'support')"><span>?</span>Support <b v-if="openTicketCount">{{ openTicketCount }}</b></button>
      <button :class="{ active: tab === 'promotions' }" @click="$emit('select', 'promotions')"><span>◆</span>Promotions</button>
      <button :class="{ active: tab === 'settings' }" @click="$emit('select', 'settings')"><span>⚙</span>Settings</button>
    </nav>
    <div class="sidebar-user">
      <div class="avatar">AD</div>
      <div><strong>Administrator</strong><span><i></i> Online</span></div>
      <button title="Sign out" @click="$emit('logout')">↪</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  tab: string;
  stats: { totalUsers: number; pendingKyc: number; pendingRequests: number };
  openTicketCount: number;
}>();
defineEmits<{ select: [tab: string]; logout: [] }>();
</script>
