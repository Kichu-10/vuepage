import { createApp } from "vue";
import App from "./App.vue";
import AdminApp from "./AdminApp.vue";

createApp(window.location.pathname.startsWith("/admin") ? AdminApp : App).mount("#app");
