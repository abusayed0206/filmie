import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "filmy-site",
    compatibilityDate: "2026-10-06",
    domains: ["filmy.sayed.app"],
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "404-page",
    },
  },
});
