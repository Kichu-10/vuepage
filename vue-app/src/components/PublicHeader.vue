<template>
  <header class="topbar">
    <button class="header-icon menu-button" aria-label="Open menu" @click="$emit('open-menu')">
      <Menu :size="25" :stroke-width="2.4" />
    </button>
    <a class="public-brand" href="#" aria-label="B9 Game home" @click.prevent="$emit('home')">
      <img :src="logo" class="brand-emblem" alt="B9" />
      <span class="brand-wordmark">B9 Game</span>
    </a>
    <div class="header-actions">
      <button class="balance-button" aria-label="Wallet balance, open deposit" @click="$emit('deposit')">
        <Wallet class="wallet-icon" :size="18" :stroke-width="2.8" />
        <span class="balance-value">{{ balanceLabel }}</span>
        <span class="add-icon"><Plus :size="16" :stroke-width="3" /></span>
      </button>
      <button class="header-icon search-button" aria-label="Search games" @click="$emit('toggle-search')">
        <Search :size="24" :stroke-width="2" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Menu, Plus, Search, Wallet } from "lucide-vue-next";

defineProps<{ logo: string; balanceLabel: string }>();
defineEmits<{ "open-menu": []; home: []; deposit: []; "toggle-search": [] }>();
</script>
