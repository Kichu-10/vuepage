import { createApp } from "vue";
import App from "./App.vue";
import AdminApp from "./AdminApp.vue";

const configuredAdminPath = String(import.meta.env.VITE_ADMIN_PANEL_PATH || "").trim();
const adminPath = configuredAdminPath
  ? (configuredAdminPath.startsWith("/") ? configuredAdminPath : `/${configuredAdminPath}`)
  : "/admin";

createApp(window.location.pathname === adminPath ? AdminApp : App).mount("#app");
