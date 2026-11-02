import { defineStore } from "pinia";
import { ref, watch } from "vue";

function storedToken(key: string): string {
  return typeof localStorage === "undefined" ? "" : localStorage.getItem(key) || "";
}

function persistToken(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

export const useSessionStore = defineStore("session", () => {
  const userToken = ref(storedToken("b9_token"));
  const adminToken = ref(storedToken("b9_admin_token"));
  watch(userToken, (value) => persistToken("b9_token", value), { flush: "sync" });
  watch(adminToken, (value) => persistToken("b9_admin_token", value), { flush: "sync" });
  return { userToken, adminToken };
});
