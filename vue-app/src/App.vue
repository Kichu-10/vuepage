<template>
  <div class="page-frame">
    <header class="topbar">
      <button class="header-icon menu-button" aria-label="Open menu" @click="modal = 'menu'">
        <Menu :size="25" :stroke-width="2.4" />
      </button>
      <a class="brand" href="#" aria-label="B9 Game home" @click.prevent="goHome">
        <svg class="brand-emblem" viewBox="0 0 42 46" role="img" aria-label="Crowned 9">
          <path d="M7 12 3 5l8 3 5-7 5 7 8-3-4 8" fill="#fff" />
          <path d="M12 17c0-6 4-10 11-10 9 0 14 7 14 17 0 12-7 19-17 19-5 0-9-2-12-5l5-6c2 2 4 3 7 3 5 0 8-4 9-10-2 3-5 4-9 4-6 0-11-4-11-12Zm10 0c0 3 2 5 5 5s5-2 5-5-2-5-5-5-5 2-5 5Z" fill="#fff" />
        </svg>
        <span class="brand-wordmark">B9 Game</span>
      </a>

      <div class="header-actions">
        <button class="balance-button" aria-label="Wallet balance, open deposit" @click="openDeposit">
          <Wallet class="wallet-icon" :size="18" :stroke-width="2.8" />
          <span class="balance-value">{{ signedIn ? formatMoney(balance) : "--" }}</span>
          <span class="add-icon"><Plus :size="16" :stroke-width="3" /></span>
        </button>
        <button class="deposit-button" @click="openDeposit">Deposit <ChevronDown :size="14" /></button>
        <button class="header-icon search-button" aria-label="Search games" @click="searchOpen = !searchOpen">
          <Search :size="24" :stroke-width="2" />
        </button>
      </div>
    </header>

    <div v-if="searchOpen" class="search-wrap">
      <Search class="search-input-icon" :size="18" />
      <input v-model="query" autofocus placeholder="Search games..." aria-label="Search games" />
      <button class="clear-search" aria-label="Close search" @click="searchOpen = false; query = ''"><X :size="18" /></button>
    </div>

    <main class="content">
      <section class="promo-frame" aria-label="Promotions">
        <div class="hero">
          <img :src="banner" alt="B9 Game first deposit promotion" class="hero-image" />
          <div class="hero-copy">
            <p class="hero-title"><span>{{ currentSlide.t1 }}</span> <strong>{{ currentSlide.big }}</strong></p>
            <p class="hero-subtitle">{{ currentSlide.sub }}</p>
            <p class="hero-amount"><small>UP TO</small>{{ currentSlide.amt }}</p>
            <button class="claim-button" @click="openDeposit">Claim Now <span><ChevronRight :size="20" :stroke-width="3" /></span></button>
          </div>
          <div class="slide-dots">
            <button
              v-for="(_, index) in slides"
              :key="index"
              :aria-label="`Show promotion ${index + 1}`"
              :class="{ active: index === slide }"
              @click="slide = index"
            />
          </div>
        </div>
      </section>

      <section class="announcement" aria-label="Latest announcement">
        <Volume2 class="announcement-volume" :size="20" :stroke-width="2.6" />
        <p>Get 100% Bonus on Your First Deposit &amp; Start Winning!</p>
        <button class="inbox-button" aria-label="Open inbox" @click="modal = 'inbox'"><Mail :size="23" /></button>
      </section>

      <nav class="categories" aria-label="Game categories">
        <button class="category-arrow" aria-label="Scroll categories left" @click="scrollCategories(-1)"><ChevronLeft :size="22" /></button>
        <div ref="categoryList" class="category-list">
          <button
            v-for="category in categoryItems"
            :key="category.label"
            class="category"
            :class="{ selected: category.label === selectedCategory }"
            @click="selectCategory(category.label)"
          >
            <span class="category-icon">
              <component :is="category.icon" v-if="category.icon" :size="category.label === 'Popular' ? 34 : 31" :stroke-width="2.7" />
              <svg
                v-else-if="category.label === 'Spribe'"
                class="spribe-mark"
                viewBox="0 0 56 28"
                role="img"
                aria-label="777"
              >
                <rect x="1.5" y="2" width="53" height="24" rx="1" />
                <path d="M6 8h10l-5 12M23 8h10l-5 12M40 8h10l-5 12" />
                <path class="digit-divider" d="M19 5v18M37 5v18" />
              </svg>
              <span v-else-if="category.mark" class="category-mark" :class="category.label.toLowerCase().replace(' ', '-')">
                {{ category.mark }}
              </span>
            </span>
            <span class="category-label">{{ category.label }}</span>
          </button>
        </div>
        <button class="category-arrow" aria-label="Scroll categories right" @click="scrollCategories(1)"><ChevronRight :size="22" /></button>
      </nav>

      <section class="jackpot" aria-label="Jackpot">
        <img :src="jackpotDecoration" alt="" class="jackpot-art jackpot-art-left" />
        <img :src="jackpotDecoration" alt="" class="jackpot-art jackpot-art-right" />
        <h2>JACKPOT</h2>
        <p>{{ jackpot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</p>
      </section>

      <section class="games-panel">
        <div class="section-heading">
          <h2><Flame class="section-flame" :size="27" :fill="'currentColor'" />{{ query ? "Results" : selectedCategory }}</h2>
          <button class="view-all" @click="showAll = !showAll">
            {{ showAll ? "Show Less" : "View All" }} <ChevronRight :size="17" />
          </button>
        </div>
        <p v-if="visibleGames.length === 0" class="empty-state">No games found</p>
        <div class="game-grid">
          <article
            v-for="game in visibleGames"
            :key="game.id"
            class="game-card"
            :class="game.theme"
            role="button"
            tabindex="0"
            :aria-label="`Play ${game.name}`"
            @click="play(game.name)"
            @keydown.enter="play(game.name)"
            @keydown.space.prevent="play(game.name)"
          >
            <img :src="game.img" :alt="game.name" loading="lazy" />
            <div class="game-shade" />
            <span class="game-brand">{{ game.brand }}</span>
            <span class="game-art-title" aria-hidden="true">{{ game.cardTitle }}</span>
            <span class="game-name">{{ game.name }}</span>
            <button
              class="favorite-button"
              :aria-label="favorites.includes(game.id) ? 'Remove favorite' : 'Add favorite'"
              @click.stop="toggleFavorite(game.id)"
            ><Star :size="17" :fill="favorites.includes(game.id) ? 'currentColor' : 'currentColor'" /></button>
          </article>
        </div>
      </section>
    </main>

    <footer class="bottom-nav">
      <button class="active-nav" @click="goHome"><Home :size="24" :fill="'currentColor'" />Home</button>
      <button @click="toggleSignIn"><component :is="signedIn ? LogOut : LogIn" :size="23" />{{ signedIn ? "Sign Out" : "Sign In" }}</button>
      <button class="nav-deposit" @click="openDeposit"><span class="wallet-circle"><Wallet :size="26" /></span>Deposit</button>
      <button @click="modal = 'promo'"><Gift :size="24" />Promotions</button>
      <button @click="openProfile"><UserRound :size="24" :fill="'currentColor'" />Profile</button>
    </footer>

    <div v-if="modal" class="modal-backdrop" @click="modal = null">
      <section class="modal-sheet" role="dialog" aria-modal="true" :aria-label="modalTitle" @click.stop>
        <div class="modal-heading">
          <h2>{{ modalTitle }}</h2>
          <button class="close-button" aria-label="Close dialog" @click="modal = null"><X :size="22" /></button>
        </div>

        <div v-if="modal === 'deposit'" class="modal-content">
          <p v-if="!bonusClaimed" class="bonus-note">100% first deposit bonus active (up to Rs. 50,000)</p>
          <div class="amount-options">
            <button
              v-for="preset in [500, 1000, 5000, 10000]"
              :key="preset"
              :class="{ chosen: amount === String(preset) }"
              @click="amount = String(preset)"
            >{{ preset.toLocaleString() }}</button>
          </div>
          <input
            v-model="amount"
            class="amount-input"
            inputmode="numeric"
            placeholder="Amount (Rs.)"
            aria-label="Deposit amount"
            @input="amount = amount.replace(/\D/g, '')"
          />
          <button class="primary-button full-button" @click="deposit">Deposit Now</button>
        </div>

        <ul v-else-if="modal === 'menu'" class="menu-list">
          <li v-for="category in categories" :key="category">
            <button @click="selectCategory(category); modal = null"><Flame :size="20" />{{ category }}</button>
          </li>
        </ul>

        <div v-else-if="modal === 'promo'" class="modal-content promo-list">
          <article v-for="promotion in slides" :key="promotion.sub" class="promo-card">
            <div>
              <strong>{{ promotion.t1 }} {{ promotion.big }}</strong>
              <p>{{ promotion.sub }} · up to {{ promotion.amt }}</p>
            </div>
            <button class="primary-button" @click="claimPromotion">Claim</button>
          </article>
        </div>

        <div v-else-if="modal === 'profile'" class="modal-content profile-info">
          <p><strong>User:</strong> Player9821</p>
          <p><strong>Balance:</strong> Rs. {{ formatMoney(balance) }}</p>
          <p><strong>First deposit bonus:</strong> {{ bonusClaimed ? "Claimed" : "Available" }}</p>
          <p><strong>Favorites:</strong> {{ favoriteNames }}</p>
        </div>

        <ul v-else-if="modal === 'inbox'" class="message-list">
          <li>Welcome to B9 Game! Claim your 100% first deposit bonus.</li>
          <li>Jackpot is over 10 million — play now!</li>
        </ul>
      </section>
    </div>

    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  ChevronDown, ChevronLeft, ChevronRight, Fish, Flame, Gift, Home,
  LogIn, LogOut, Mail, Menu, Plus, Search, Star, UserRound,
  Volume2, Wallet, X,
} from "@lucide/vue";
import banner from "./assets/banner.jpg";
import aviator from "./assets/g-aviator.jpg";
import chicken from "./assets/g-chicken.jpg";
import aviatrix from "./assets/g-aviatrix.jpg";
import mines from "./assets/g-mines.jpg";
import fish from "./assets/g-fish.jpg";
import slot from "./assets/g-slot.jpg";
import jackpotDecoration from "./assets/jackpot-indian-side.jpg";

type Category = "Popular" | "PG Slot" | "Spribe" | "Fishing" | "InOut";
type Modal = "deposit" | "menu" | "promo" | "profile" | "inbox" | null;
type Game = {
  id: number;
  name: string;
  brand: string;
  img: string;
  cardTitle: string;
  theme: string;
  categories: Category[];
};

const categories: Category[] = ["Popular", "PG Slot", "Spribe", "Fishing", "InOut"];
const categoryItems = [
  { label: "Popular" as const, icon: Flame },
  { label: "PG Slot" as const, mark: "PG" },
  { label: "Spribe" as const, mark: "777" },
  { label: "Fishing" as const, icon: Fish },
  { label: "InOut" as const, mark: "iN" },
];
const games: Game[] = [
  { id: 1, name: "Aviator", brand: "SPRIBE", img: aviator, cardTitle: "Aviator", theme: "aviator-card", categories: ["Popular", "Spribe"] },
  { id: 2, name: "Chicken Road 2", brand: "IN", img: chicken, cardTitle: "CHICKEN ROAD 2", theme: "chicken-card", categories: ["Popular", "InOut"] },
  { id: 3, name: "Aviator", brand: "SPRIBE", img: aviator, cardTitle: "Aviator", theme: "aviator-card", categories: ["Popular", "Spribe"] },
  { id: 4, name: "Aviatrix", brand: "CRASH GAME", img: aviatrix, cardTitle: "Aviatrix", theme: "aviatrix-card", categories: ["Popular"] },
  { id: 5, name: "Mines", brand: "SPRIBE", img: mines, cardTitle: "Mines", theme: "mines-card", categories: ["Popular", "Spribe"] },
  { id: 6, name: "Chicken Road", brand: "IN", img: chicken, cardTitle: "CHICKEN ROAD", theme: "chicken-card", categories: ["Popular", "InOut"] },
  { id: 7, name: "Fortune Ox", brand: "PG", img: slot, cardTitle: "Fortune Ox", theme: "fortune-card", categories: ["PG Slot"] },
  { id: 8, name: "Shark Hunter", brand: "FISHING", img: fish, cardTitle: "Shark Hunter", theme: "fishing-card", categories: ["Fishing"] },
  { id: 9, name: "Lucky Gold", brand: "PG", img: slot, cardTitle: "Lucky Gold", theme: "fortune-card", categories: ["PG Slot"] },
  { id: 10, name: "Aviator", brand: "SPRIBE", img: aviator, cardTitle: "Aviator", theme: "aviator-card", categories: ["Spribe"] },
];
const slides = [
  { t1: "Get", big: "100%", sub: "Bonus on Your First Deposit", amt: "RS. 50,000" },
  { t1: "Daily", big: "10%", sub: "Cashback on All Games", amt: "RS. 5,000" },
  { t1: "Invite", big: "Friends", sub: "Earn per Referral", amt: "RS. 500" },
  { t1: "Weekly", big: "VIP", sub: "Rewards for Members", amt: "RS. 25,000" },
];

const selectedCategory = ref<Category>("Popular");
const balance = ref(8891.2);
const jackpot = ref(10799004.2);
const slide = ref(0);
const favorites = ref<number[]>([]);
const query = ref("");
const searchOpen = ref(false);
const showAll = ref(false);
const modal = ref<Modal>(null);
const signedIn = ref(true);
const bonusClaimed = ref(false);
const amount = ref("1000");
const categoryList = ref<HTMLElement | null>(null);
const notice = ref("");
let slideTimer: ReturnType<typeof setInterval> | undefined;
let jackpotTimer: ReturnType<typeof setInterval> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const currentSlide = computed(() => slides[slide.value] ?? slides[0]!);
const visibleGames = computed(() => {
  const search = query.value.trim().toLowerCase();
  const filtered = search
    ? games.filter((game) => game.name.toLowerCase().includes(search))
    : games.filter((game) => game.categories.includes(selectedCategory.value));
  return showAll.value ? filtered : filtered.slice(0, 6);
});
const modalTitle = computed(() => modal.value === "promo" ? "Promotions" : modal.value ?? "");
const favoriteNames = computed(() => {
  const names = games.filter((game) => favorites.value.includes(game.id)).map((game) => game.name);
  return names.length ? names.join(", ") : "None yet";
});

onMounted(() => {
  slideTimer = setInterval(() => { slide.value = (slide.value + 1) % slides.length; }, 4000);
  jackpotTimer = setInterval(() => { jackpot.value += Math.random() * 25; }, 1200);
});
onUnmounted(() => {
  if (slideTimer) clearInterval(slideTimer);
  if (jackpotTimer) clearInterval(jackpotTimer);
  if (noticeTimer) clearTimeout(noticeTimer);
});

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}
function notify(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ""; }, 3000);
}
function requireSignIn(): boolean {
  if (signedIn.value) return false;
  notify("Please sign in first");
  return true;
}
function openDeposit(): void {
  if (!requireSignIn()) modal.value = "deposit";
}
function selectCategory(category: Category): void {
  selectedCategory.value = category;
  query.value = "";
  showAll.value = false;
}
function scrollCategories(direction: number): void {
  categoryList.value?.scrollBy({ left: direction * 120, behavior: "smooth" });
}
function toggleFavorite(id: number): void {
  favorites.value = favorites.value.includes(id)
    ? favorites.value.filter((favorite) => favorite !== id)
    : [...favorites.value, id];
}
function play(name: string): void {
  if (requireSignIn()) return;
  if (balance.value < 10) {
    notify("Low balance — please deposit");
    modal.value = "deposit";
    return;
  }
  const bet = 10;
  const win = Math.random() < 0.45 ? Math.round(bet * (1 + Math.random() * 4)) : 0;
  balance.value = balance.value - bet + win;
  notify(win ? `${name}: you won Rs. ${win}!` : `${name}: lost Rs. ${bet}. Try again!`);
}
function deposit(): void {
  const value = Number(amount.value);
  if (!value || value < 100) {
    notify("Minimum deposit is Rs. 100");
    return;
  }
  const bonus = bonusClaimed.value ? 0 : Math.min(value, 50000);
  balance.value += value + bonus;
  if (bonus) bonusClaimed.value = true;
  modal.value = null;
  notify(`Deposited Rs. ${value}${bonus ? ` + Rs. ${bonus} bonus` : ""}`);
}
function claimPromotion(): void {
  if (requireSignIn()) return;
  modal.value = "deposit";
}
function toggleSignIn(): void {
  signedIn.value = !signedIn.value;
  notify(signedIn.value ? "Welcome back!" : "Signed out");
}
function openProfile(): void {
  if (!requireSignIn()) modal.value = "profile";
}
function goHome(): void {
  modal.value = null;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
</script>

<style>
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #355342;
  background: #e8f4e9;
  font-synthesis: none;
  font-optical-sizing: auto;
}
* { box-sizing: border-box; }
html { min-width: 320px; background: #e8f4e9; }
body { margin: 0; min-height: 100vh; }
button, input { font: inherit; }
button { cursor: pointer; }
.page-frame {
  width: min(100%, 480px);
  min-height: 100vh;
  margin: 0 auto;
  padding-bottom: calc(91px + env(safe-area-inset-bottom));
  overflow: hidden;
  background: #f6faf6;
  box-shadow: 0 0 36px rgb(34 91 51 / 8%);
}
.topbar {
  display: flex;
  height: 62px;
  align-items: center;
  gap: 7px;
  padding: 4px 12px 10px;
  color: white;
  background: #20b763;
}
.header-icon { display: grid; flex: 0 0 auto; place-items: center; padding: 0; border: 0; color: inherit; background: none; }
.menu-button { width: 25px; }
.brand { display: flex; min-width: 0; flex: 0 1 auto; align-items: center; gap: 1px; color: white; text-decoration: none; }
.brand-emblem { width: 37px; height: 42px; flex: 0 0 auto; }
.brand-wordmark { white-space: nowrap; font-size: clamp(15px, 4.3vw, 20px); font-weight: 850; letter-spacing: -.7px; }
.header-actions { display: flex; min-width: 0; flex: 1; align-items: center; justify-content: flex-end; gap: 5px; }
.balance-button, .deposit-button {
  display: flex;
  height: 38px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  border-radius: 12px;
  color: #344c3c;
  background: white;
  white-space: nowrap;
}
.balance-button { min-width: 0; padding: 0 7px; }
.wallet-icon { flex: 0 0 auto; color: #20aa5b; fill: #20aa5b; }
.balance-value { color: #b66b35; font-size: clamp(11px, 3.2vw, 14px); font-weight: 750; font-variant-numeric: tabular-nums; }
.add-icon { display: grid; width: 21px; height: 21px; flex: 0 0 auto; place-items: center; border-radius: 50%; color: white; background: #26b76b; }
.deposit-button { gap: 2px; padding: 0 8px; font-size: 12px; font-weight: 600; }
.search-button { width: 25px; }
.search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 9px 14px 12px;
  background: #20b763;
}
.search-input-icon, .clear-search { flex: 0 0 auto; color: #fff; }
.search-wrap input { width: 100%; padding: 9px 12px; border: 0; border-radius: 10px; outline: none; color: #273f31; background: #fff; }
.clear-search { display: grid; place-items: center; padding: 2px; border: 0; background: none; }
.content { display: flex; flex-direction: column; gap: 10px; padding: 9px 11px 16px; }
.promo-frame { padding: 8px; border-radius: 28px; background: #fff; box-shadow: 0 3px 12px rgb(32 98 51 / 5%); }
.hero { position: relative; aspect-ratio: 2.28 / 1; overflow: hidden; border-radius: 20px; color: #fff; background: #08733d; }
.hero::after { position: absolute; inset: 0; content: ""; background: linear-gradient(90deg, rgb(3 83 39 / 38%) 0%, transparent 58%); pointer-events: none; }
.hero-image { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.hero-copy { position: absolute; z-index: 1; inset: 0 auto 0 0; display: flex; max-width: 59%; flex-direction: column; justify-content: center; padding: 2px 0 2px 11%; text-shadow: 0 1px 5px rgb(0 56 24 / 25%); }
.hero-title { display: flex; align-items: baseline; gap: 7px; margin: 0; font-size: clamp(15px, 4.6vw, 23px); font-weight: 750; line-height: 1; }
.hero-title strong { font-size: clamp(28px, 9.5vw, 50px); font-weight: 900; letter-spacing: -1.5px; }
.hero-subtitle { max-width: 240px; margin: 3px 0 0; font-size: clamp(11px, 3.8vw, 17px); font-weight: 750; line-height: 1.15; }
.hero-amount { display: flex; flex-direction: column; margin: 4px 0 0; color: #ffe66d; font-size: clamp(21px, 7vw, 37px); font-weight: 900; line-height: .96; white-space: nowrap; }
.hero-amount small { margin-bottom: 2px; color: #acd59c; font-size: 9px; font-weight: 750; }
.claim-button { display: flex; width: fit-content; align-items: center; gap: 6px; margin-top: 6px; padding: 5px 7px 5px 12px; border: 0; border-radius: 99px; color: white; background: #28bf70; font-size: clamp(11px, 3.6vw, 15px); font-weight: 650; text-shadow: none; }
.claim-button > span { display: grid; width: 21px; height: 21px; place-items: center; border-radius: 50%; color: #229e5a; background: white; }
.slide-dots { position: absolute; z-index: 2; bottom: 8px; left: 50%; display: flex; gap: 5px; transform: translateX(-50%); }
.slide-dots button { width: 8px; height: 8px; padding: 0; border: 0; border-radius: 9px; background: rgb(255 255 255 / 55%); }
.slide-dots button.active { background: white; }
.announcement { display: flex; min-height: 43px; align-items: center; gap: 10px; padding: 5px 7px 5px 14px; border-radius: 14px; color: #426d51; background: #e7f4e9; }
.announcement-volume { flex: 0 0 auto; color: #36a564; fill: #36a564; }
.announcement p { flex: 1; overflow: hidden; margin: 0; font-size: clamp(11px, 3.4vw, 14px); white-space: nowrap; text-overflow: ellipsis; }
.inbox-button { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border: 0; border-radius: 10px; color: white; background: #17a854; }
.categories { display: flex; min-height: 91px; align-items: center; padding: 6px 5px 4px; border-radius: 19px; background: white; box-shadow: 0 3px 13px rgb(27 88 47 / 5%); }
.category-arrow { display: grid; width: 24px; flex: 0 0 24px; place-items: center; padding: 0; border: 0; color: #8d9991; background: none; }
.category-list { display: flex; flex: 1; justify-content: space-around; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.category-list::-webkit-scrollbar { display: none; }
.category { display: flex; min-width: 51px; flex: 1; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; padding: 0; border: 0; color: #707b73; background: none; font-size: 12px; }
.category-icon { display: grid; height: 39px; place-items: center; color: #16994d; }
.category:first-child .category-icon svg { fill: currentColor; stroke: #16994d; }
.category-label { padding: 0 3px 5px; border-bottom: 2px solid transparent; white-space: nowrap; }
.category.selected .category-label { border-color: #27a95c; color: #315940; font-weight: 700; }
.category-mark { display: grid; place-items: center; color: #13a356; font-size: 23px; font-weight: 900; line-height: 1; }
.category-mark.pg-slot { width: 30px; height: 30px; border-radius: 50% 50% 45% 45%; color: #fff; background: #18a657; font-size: 13px; letter-spacing: -1px; }
.spribe-mark { width: 56px; height: 29px; overflow: visible; fill: none; stroke: #129b50; stroke-width: 2; stroke-linecap: square; stroke-linejoin: miter; }
.spribe-mark > path:not(.digit-divider) { stroke-width: 2.8; }
.spribe-mark > .digit-divider { stroke-width: 1; }
.category-mark.inout { font-size: 23px; font-style: italic; letter-spacing: -3px; }
.jackpot { position: relative; display: flex; min-height: 98px; flex-direction: column; align-items: center; justify-content: center; gap: 3px; overflow: hidden; border-radius: 18px; background: linear-gradient(110deg, #e1f0e2, #edf6e9 50%, #e1f0e2); }
.jackpot-art { position: absolute; z-index: 0; top: 0; width: 145px; height: 100%; object-fit: contain; pointer-events: none; }
.jackpot-art-left { left: -8px; }
.jackpot-art-right { right: -8px; transform: scaleX(-1); }
.jackpot h2 { position: relative; z-index: 1; margin: 0; color: #2a9148; font-size: clamp(19px, 6vw, 28px); font-weight: 900; letter-spacing: .5px; line-height: 1.05; }
.jackpot p { position: relative; z-index: 1; max-width: 48%; margin: 0; padding: 3px 8px 4px; border: 2px solid #e8f0d7; border-radius: 99px; color: #187546; background: #fffef4; box-shadow: 0 2px 7px rgb(52 102 59 / 8%); font-size: clamp(12px, 4vw, 23px); font-weight: 850; letter-spacing: -.35px; line-height: 1.18; white-space: nowrap; font-variant-numeric: tabular-nums; }
.games-panel { padding: 9px 7px 10px; border-radius: 18px 18px 0 0; background: white; }
.section-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 4px 10px; }
.section-heading h2 { display: flex; align-items: center; gap: 7px; margin: 0; color: #385e46; font-size: 16px; font-weight: 750; }
.section-flame { color: #169b4d; }
.view-all { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border: 0; border-radius: 99px; color: #50765b; background: #edf6ed; font-size: 12px; }
.game-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.game-card { position: relative; aspect-ratio: .86; overflow: hidden; border-radius: 15px; background: #138841; cursor: pointer; isolation: isolate; }
.game-card > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .22s ease; }
.game-card:hover > img { transform: scale(1.04); }
.game-shade { position: absolute; z-index: 1; inset: 0; background: linear-gradient(180deg, rgb(0 25 10 / 16%) 0%, transparent 34%, rgb(0 24 12 / 44%) 100%); }
.game-card.aviator-card { background: #087d3c; }
.game-card.aviator-card > img { filter: hue-rotate(42deg) saturate(1.2) brightness(.74); }
.game-card.chicken-card > img { filter: saturate(1.35) contrast(1.04); }
.game-card.aviatrix-card > img { filter: hue-rotate(50deg) saturate(1.2) brightness(.75); }
.game-card.mines-card > img { filter: saturate(1.35) hue-rotate(4deg); }
.game-card.fortune-card > img { filter: hue-rotate(290deg) saturate(1.3); }
.game-brand { position: absolute; z-index: 2; top: 9px; left: 8px; color: white; font-size: clamp(8px, 2.4vw, 11px); font-weight: 900; text-decoration: underline; text-shadow: 0 1px 3px rgb(0 0 0 / 40%); }
.game-art-title { position: absolute; z-index: 2; right: 3px; bottom: 27px; left: 3px; color: white; font-size: clamp(12px, 4vw, 20px); font-style: italic; font-weight: 1000; line-height: .95; text-align: center; text-shadow: 1px 2px 2px #1d2220, -1px -1px 1px rgb(255 255 255 / 55%); }
.aviator-card .game-art-title { color: #ff2d55; font-family: Georgia, serif; font-size: clamp(16px, 5vw, 25px); }
.mines-card .game-art-title { font-style: normal; font-size: clamp(22px, 7vw, 32px); text-align: left; padding-left: 12px; }
.game-name { position: absolute; z-index: 2; right: 4px; bottom: 7px; left: 4px; color: white; font-size: 12px; font-weight: 700; text-align: center; text-shadow: 0 1px 3px rgb(0 0 0 / 55%); }
.favorite-button { position: absolute; z-index: 3; top: 7px; right: 7px; display: grid; width: 27px; height: 27px; place-items: center; padding: 0; border: 0; border-radius: 50%; color: #267c48; background: white; box-shadow: 0 2px 6px rgb(0 0 0 / 12%); }
.empty-state { padding: 20px 0; color: #6d786f; text-align: center; font-size: 13px; }
.bottom-nav {
  position: fixed;
  z-index: 5;
  bottom: 0;
  left: 50%;
  display: flex;
  width: min(100%, 480px);
  min-height: 76px;
  align-items: flex-end;
  justify-content: space-around;
  padding: 8px 8px calc(7px + env(safe-area-inset-bottom));
  border-radius: 23px 23px 0 0;
  background: rgb(255 255 255 / 97%);
  box-shadow: 0 -3px 16px rgb(32 79 46 / 10%);
  transform: translateX(-50%);
}
.bottom-nav button { display: flex; min-width: 48px; flex-direction: column; align-items: center; gap: 3px; padding: 0; border: 0; color: #9da69f; background: none; font-size: 10px; }
.bottom-nav button > svg { stroke-width: 2; }
.bottom-nav button.active-nav { color: #159a4b; }
.bottom-nav .wallet-circle { display: grid; width: 53px; height: 53px; margin-top: -28px; margin-bottom: 1px; place-items: center; border-radius: 50%; color: #fff; background: #1caf58; box-shadow: 0 3px 8px rgb(29 126 62 / 20%); }
.modal-backdrop { position: fixed; z-index: 10; inset: 0; display: flex; align-items: flex-end; justify-content: center; background: rgb(17 35 23 / 55%); }
.modal-sheet { width: min(100%, 480px); max-height: 82vh; overflow-y: auto; padding: 18px 18px calc(28px + env(safe-area-inset-bottom)); border-radius: 25px 25px 0 0; background: white; }
.modal-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.modal-heading h2 { margin: 0; color: #315940; font-size: 19px; text-transform: capitalize; }
.close-button { display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: 50%; color: #59665d; background: #f0f5f0; }
.modal-content { display: flex; flex-direction: column; gap: 12px; }
.bonus-note { margin: 0; padding: 9px; border-radius: 9px; color: #267c36; background: #e5f3e3; font-size: 13px; }
.amount-options { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.amount-options button { padding: 9px 3px; border: 1px solid #d5ded6; border-radius: 9px; background: white; font-size: 13px; }
.amount-options button.chosen { border-color: #319d42; background: #e5f3e3; font-weight: 700; }
.amount-input { width: 100%; padding: 11px 14px; border: 1px solid #d5ded6; border-radius: 12px; outline-color: #27a95c; }
.primary-button { border: 0; border-radius: 999px; padding: 8px 14px; color: white; background: #23ae5e; font-weight: 650; }
.full-button { width: 100%; padding: 12px; }
.menu-list, .message-list { margin: 0; padding: 0; list-style: none; }
.menu-list li + li, .message-list li + li { margin-top: 5px; }
.menu-list button { display: flex; width: 100%; align-items: center; gap: 12px; padding: 10px; border: 0; border-radius: 9px; color: #355342; text-align: left; background: white; }
.menu-list button:hover { background: #e5f3e3; }
.promo-list { gap: 8px; }
.promo-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px; border-radius: 12px; background: #e5f3e3; }
.promo-card p { margin: 3px 0 0; color: #707b73; font-size: 12px; }
.promo-card .primary-button { padding: 7px 12px; font-size: 12px; }
.profile-info p { margin: 0; font-size: 14px; }
.message-list li { padding: 12px; border-radius: 10px; background: #e5f3e3; font-size: 13px; }
.toast { position: fixed; z-index: 20; bottom: 88px; left: 50%; max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 99px; color: white; background: #27382b; box-shadow: 0 4px 16px rgb(0 0 0 / 20%); text-align: center; font-size: 13px; transform: translateX(-50%); }
@media (min-width: 480px) {
  .page-frame { min-height: 100vh; }
}
@media (max-width: 370px) {
  .topbar { gap: 4px; padding-right: 8px; padding-left: 8px; }
  .menu-button { width: 23px; }
  .brand-emblem { width: 31px; }
  .brand-wordmark { font-size: 15px; }
  .header-actions { gap: 4px; }
  .balance-button { gap: 4px; padding: 0 5px; }
  .deposit-button { gap: 0; padding: 0 6px; font-size: 11px; }
  .search-button { width: 22px; }
  .search-button svg { width: 21px; }
  .content { gap: 8px; padding-right: 7px; padding-left: 7px; }
  .categories { min-height: 82px; }
  .category { min-width: 46px; font-size: 11px; }
  .jackpot { border-radius: 14px; }
  .jackpot-art { width: 128px; }
  .jackpot p { max-width: 50%; padding-right: 7px; padding-left: 7px; font-size: 14px; }
  .game-grid { gap: 6px; }
}
</style>
