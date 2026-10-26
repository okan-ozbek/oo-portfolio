import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vinext()],
  server: {
    host: "127.0.0.1",
    fs: {
      deny: ["**/.env*", "**/*.{crt,pem,key}", "**/.git/**", "**/.admin-local-password", "**/data/**", "**/.deploy-secrets/**"],
    },
    proxy: Object.fromEntries(["/admin", "/api/admin", "/r/"].map(path => [path, {
      target: process.env.PIXELWARE_ADMIN_TARGET ?? "http://127.0.0.1:3031",
    }])),
  },
});
