import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import AdminApp from "./AdminApp.vue";

const configuredAdminPath = String(import.meta.env.VITE_ADMIN_PANEL_PATH || "").trim();
const adminPath = configuredAdminPath
  ? (configuredAdminPath.startsWith("/") ? configuredAdminPath : `/${configuredAdminPath}`)
  : "/admin";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: adminPath, component: AdminApp },
    { path: "/:pathMatch(.*)*", component: App },
  ],
});
