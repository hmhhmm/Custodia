// STATUS: stub. VERIFY: exact `defineConfig` import path and current
// @vitejs/plugin-react API before relying on this.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
