// import { defineConfig } from "vite";
// import vue from "@vitejs/plugin-vue";

// export default defineConfig({
//   plugins: [vue()],
//   server: {
//     proxy: {
//       "/api": {
//         target: "http://127.0.0.1:3001",
//         changeOrigin: true,
//       },
//       "/uploads": {
//         target: "http://127.0.0.1:3001",
//         changeOrigin: true,
//       },
//     },
//   },
// });
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    // Allows ngrok tunnels to connect to your local dev server
    allowedHosts: ['.ngrok-free.app', '.ngrok.app'],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
