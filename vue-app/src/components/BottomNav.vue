<template>
  <footer class="bottom-nav">
    <button :class="{ 'active-nav': activePage === '/' }" @click="$emit('navigate', '/')"><Home :size="23" />Home</button>
    <button :class="{ 'active-nav': activePage === '/games' }" @click="$emit('navigate', '/games')"><Gamepad2 :size="23" />Games</button>
    <button :class="{ 'active-nav': activePage === '/wallet' }" @click="$emit('navigate', '/wallet')"><Wallet :size="23" />Wallet</button>
    <button :class="{ 'active-nav': activePage === '/promotions' }" @click="$emit('navigate', '/promotions')"><Gift :size="23" />Promotions</button>
    <button :class="{ 'active-nav': activePage === '/account' }" @click="$emit('navigate', '/account')"><UserRound :size="23" />Account</button>
  </footer>
</template>

<script setup lang="ts">
import { Gamepad2, Gift, Home, UserRound, Wallet } from "lucide-vue-next";

defineProps<{ activePage: string }>();
defineEmits<{ navigate: [path: string] }>();
</script>
