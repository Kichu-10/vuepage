<template>
  <section class="bonus-banner" :aria-label="`${currentSlide.label} banner`">
    <img
      class="bonus-banner__art"
      :src="artwork"
      alt="B9 Game bonus promotion with a woman, Pakistani flag, gifts, and cash"
      width="571"
      height="532"
      loading="eager"
      fetchpriority="high"
      decoding="async"
    />
    <template v-if="currentSlide.id === 'bonus'">
      <p class="bonus-banner__line bonus-banner__l1">Get <b>100%</b></p>
      <p class="bonus-banner__line bonus-banner__l2">Bonus</p>
      <p class="bonus-banner__line bonus-banner__l3">on Your First Deposit</p>
      <div class="bonus-banner__pill" aria-hidden="true"></div>
      <span class="bonus-banner__upto">UP TO</span>
      <span class="bonus-banner__rs">RS.</span>
      <span class="bonus-banner__num">50,000</span>
      <button class="bonus-banner__btn" type="button" @click="$emit('claim')">
        <span>Claim Now</span>
        <i aria-hidden="true"><ChevronRight :size="18" :stroke-width="3" /></i>
      </button>
    </template>
    <template v-else-if="currentSlide.id === 'games'">
      <p class="bonus-banner__line bonus-banner__l1">Explore <b>Games</b></p>
      <p class="bonus-banner__line bonus-banner__l2">Find your next favorite</p>
      <button class="bonus-banner__btn" type="button" @click="$emit('navigate', '/games')">
        <span>Play Games</span>
        <i aria-hidden="true"><ChevronRight :size="18" :stroke-width="3" /></i>
      </button>
    </template>
    <template v-else-if="currentSlide.id === 'promotions'">
      <p class="bonus-banner__line bonus-banner__l1">Special <b>Offers</b></p>
      <p class="bonus-banner__line bonus-banner__l2">Exclusive promotions await</p>
      <button class="bonus-banner__btn" type="button" @click="$emit('navigate', '/promotions')">
        <span>View Offers</span>
        <i aria-hidden="true"><ChevronRight :size="18" :stroke-width="3" /></i>
      </button>
    </template>
    <template v-else>
      <p class="bonus-banner__line bonus-banner__l1">Secure <b>Wallet</b></p>
      <p class="bonus-banner__line bonus-banner__l2">Manage your balance</p>
      <button class="bonus-banner__btn" type="button" @click="$emit('navigate', '/wallet')">
        <span>Open Wallet</span>
        <i aria-hidden="true"><ChevronRight :size="18" :stroke-width="3" /></i>
      </button>
    </template>
    <img class="bonus-banner__logo" :src="badge" alt="B9" />
    <div class="bonus-banner__dots" role="group" aria-label="Promotional banners">
      <button
        v-for="(slide, index) in slides"
        :key="slide.id"
        type="button"
        :class="{ active: index === activeIndex }"
        :aria-label="`Show ${slide.label}`"
        :aria-current="index === activeIndex ? 'true' : undefined"
        @click="selectSlide(index)"
      />
    </div>
    <button class="bonus-banner__arrow bonus-banner__arrow--prev" type="button" aria-label="Previous banner" @click="moveSlide(-1)">
      <ChevronLeft :size="22" :stroke-width="2.5" />
    </button>
    <button class="bonus-banner__arrow bonus-banner__arrow--next" type="button" aria-label="Next banner" @click="moveSlide(1)">
      <ChevronRight :size="22" :stroke-width="2.5" />
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import artwork from "../assets/bonus-banner-art.webp";
import badge from "../assets/b9-banner-logo.svg";

const props = defineProps<{
  activeIndex?: number;
  slides?: Array<{ id: string; label: string }>;
}>();

const emit = defineEmits<{
  claim: [];
  navigate: [path: string];
  "slide-change": [index: number];
}>();

const fallbackSlides = [
  { id: "bonus", label: "first deposit bonus" },
  { id: "games", label: "games" },
  { id: "promotions", label: "promotions" },
  { id: "wallet", label: "wallet" },
];
const slides = computed(() => props.slides?.length ? props.slides : fallbackSlides);
const activeIndex = ref(Math.min(props.activeIndex ?? 0, slides.value.length - 1));
const currentSlide = computed(() => slides.value[activeIndex.value] ?? fallbackSlides[0]);

watch(() => props.activeIndex, (index) => {
  if (typeof index === "number") activeIndex.value = Math.min(index, slides.value.length - 1);
});

function moveSlide(direction: number): void {
  const next = (activeIndex.value + direction + slides.value.length) % slides.value.length;
  activeIndex.value = next;
  emit("slide-change", next);
}

function selectSlide(index: number): void {
  activeIndex.value = index;
  emit("slide-change", index);
}
</script>

<style scoped>
.bonus-banner {
  container-type: inline-size;
  position: relative;
  width: 100%;
  max-width: 1240px;
  aspect-ratio: 1240 / 548;
  margin: 0 auto;
  overflow: hidden;
  border: 2px solid #159447;
  border-radius: 2.3cqw;
  color: #fff;
  font-family: Poppins, "Segoe UI", Arial, sans-serif;
  background: linear-gradient(180deg, #28a352 0%, #12853a 36%, #0b6c2c 47%, #065822 60%, #014a1d 77%, #04451b 100%);
}
.bonus-banner > * { position: absolute; z-index: 1; }
.bonus-banner::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  background-image: radial-gradient(rgb(255 255 255 / 8%) 1.2px, transparent 1.4px);
  background-size: 1.1cqw 1.1cqw;
  content: "";
}
.bonus-banner__art {
  top: .65cqw;
  left: 52.8cqw;
  width: 46.05cqw;
  height: 42.9cqw;
  object-fit: contain;
  object-position: right bottom;
  pointer-events: none;
}
.bonus-banner__line { left: 11.7cqw; margin: 0; white-space: nowrap; font-weight: 700; line-height: 1; }
.bonus-banner__l1 { top: 5.2cqw; font-size: 4.9cqw; }
.bonus-banner__l1 b { margin-left: .3cqw; font-size: 9.1cqw; font-weight: 800; vertical-align: -.35cqw; }
.bonus-banner__l2 { top: 14.4cqw; font-size: 3.65cqw; font-weight: 600; }
.bonus-banner__l3 { top: 19.3cqw; font-size: 3.44cqw; font-weight: 600; }
.bonus-banner__pill { top: 25.4cqw; left: 12.1cqw; width: 36.3cqw; height: 7.4cqw; border-radius: 10cqw; background: rgb(0 0 0 / 17%); }
.bonus-banner__upto { top: 26.1cqw; left: 14.9cqw; color: #6fc990; font-size: 2cqw; font-weight: 600; line-height: 1; }
.bonus-banner__rs { top: 28.1cqw; left: 14.9cqw; font-size: 4.8cqw; font-weight: 800; line-height: 1; }
.bonus-banner__num {
  top: 25.7cqw;
  left: 24.4cqw;
  color: #f5c93a;
  background: linear-gradient(#fff2b0 0%, #f5c93a 55%, #d79a0c 100%);
  background-clip: text;
  font-size: 6.7cqw;
  font-weight: 800;
  line-height: 1.1;
  white-space: nowrap;
  -webkit-text-fill-color: transparent;
}
.bonus-banner__btn {
  top: 35.5cqw;
  left: 11.9cqw;
  display: flex;
  width: 26.2cqw;
  height: 6.5cqw;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.4cqw 0 3cqw;
  border: 0;
  border-radius: 10cqw;
  color: #fff;
  background: linear-gradient(#6fdb5f 0%, #34a43f 100%);
  box-shadow: 0 .5cqw 1.2cqw rgb(0 0 0 / 30%), inset 0 0 0 .2cqw rgb(255 255 255 / 25%);
  font-size: 2.8cqw;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: transform .15s ease, filter .15s ease;
}
.bonus-banner__btn i {
  display: grid;
  width: 3.5cqw;
  height: 3.5cqw;
  place-items: center;
  padding-bottom: .3cqw;
  box-sizing: border-box;
  border-radius: 50%;
  color: #2a9a3b;
  background: #fff;
  font-size: 3.2cqw;
  font-style: normal;
  font-weight: 800;
  line-height: 1;
}
.bonus-banner__btn i :deep(svg) { display: block; }
.bonus-banner__btn:hover { transform: translateY(-.2cqw); filter: brightness(1.08); }
.bonus-banner__btn:focus-visible { outline: .3cqw solid #fff; outline-offset: .3cqw; }
.bonus-banner__arrow {
  z-index: 3;
  top: 50%;
  display: grid;
  width: 4.2cqw;
  height: 4.2cqw;
  place-items: center;
  padding: 0;
  transform: translateY(-50%);
  border: 1px solid rgb(255 255 255 / 48%);
  border-radius: 50%;
  color: #fff;
  background: rgb(0 53 24 / 42%);
  cursor: pointer;
  opacity: .8;
  transition: background .15s ease, opacity .15s ease;
}
.bonus-banner__arrow:hover { background: rgb(0 53 24 / 72%); opacity: 1; }
.bonus-banner__arrow--prev { left: 1.5cqw; }
.bonus-banner__arrow--next { right: 1.5cqw; }
.bonus-banner__arrow :deep(svg) { width: 2.4cqw; height: 2.4cqw; }
.bonus-banner__logo {
  top: 20.9cqw;
  left: .6cqw;
  width: 9.5cqw;
  height: 11cqw;
  object-fit: contain;
  object-position: center;
  filter: drop-shadow(0 .18cqw .28cqw rgb(0 0 0 / 25%));
}
.bonus-banner__dots { z-index: 3; top: 40.2cqw; left: 45.4cqw; display: flex; gap: 1cqw; }
.bonus-banner__dots button { width: 1.9cqw; height: 1.9cqw; padding: 0; border: 0; border-radius: 50%; background: rgb(255 255 255 / 40%); cursor: pointer; }
.bonus-banner__dots button.active { background: #fff; }
@media (max-width: 480px) {
  .bonus-banner { border-radius: 12px; }
  .bonus-banner__line { left: 10cqw; }
  .bonus-banner__l1 { font-size: 5cqw; }
  .bonus-banner__l1 b { font-size: 9.2cqw; }
  .bonus-banner__l2 { font-size: 3.8cqw; }
  .bonus-banner__l3 { font-size: 3.6cqw; }
  .bonus-banner__pill { left: 10.4cqw; width: 38cqw; }
  .bonus-banner__upto, .bonus-banner__rs { left: 13cqw; }
  .bonus-banner__num { left: 24cqw; }
  .bonus-banner__btn { left: 10cqw; width: 28cqw; }
  .bonus-banner__logo { left: .3cqw; }
  .bonus-banner__arrow { width: 6cqw; height: 6cqw; }
  .bonus-banner__arrow :deep(svg) { width: 3.4cqw; height: 3.4cqw; }
}
</style>
