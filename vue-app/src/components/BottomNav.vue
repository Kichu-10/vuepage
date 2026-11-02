<template>
  <footer class="bottom-nav">
    <button class="active-nav" @click="$emit('home')"><Home :size="24" :fill="'currentColor'" />Home</button>
    <button @click="$emit('auth')"><component :is="signedIn ? LogOut : LogIn" :size="23" />{{ signedIn ? "Sign Out" : "Sign In" }}</button>
    <button class="nav-deposit" @click="$emit('deposit')"><span class="wallet-circle"><Wallet :size="26" /></span>Deposit</button>
    <button @click="$emit('promotions')"><Gift :size="24" />Promotions</button>
    <button @click="$emit('profile')"><UserRound :size="24" :fill="'currentColor'" />Profile</button>
  </footer>
</template>

<script setup lang="ts">
import { Gift, Home, LogIn, LogOut, UserRound, Wallet } from "lucide-vue-next";

defineProps<{ signedIn: boolean }>();
defineEmits<{ home: []; auth: []; deposit: []; promotions: []; profile: [] }>();
</script>
