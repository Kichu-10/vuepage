import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { RouterView } from "vue-router";
import { router } from "./router";

createApp({
  render: () => h(RouterView),
})
  .use(createPinia())
  .use(router)
  .mount("#app");
