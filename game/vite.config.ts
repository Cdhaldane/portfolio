import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/*
 * The game is a standalone app served from /hymn/ on the portfolio's domain.
 * It builds INTO the CRA output directory, which is why the portfolio's
 * `build` script must run CRA first and this second — reversed, CRA's clean
 * step deletes the game. See GALLOWS_HYMN.md §18.1.
 */
export default defineConfig({
  base: "/hymn/",
  plugins: [react()],
  build: {
    outDir: "../build/hymn",
    emptyOutDir: true,
    target: "es2022",
    assetsDir: "assets",
  },
  server: {
    port: 3040,
    open: false,
  },
});
