import { defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "filmie-site",
		compatibilityDate: "2026-10-06",
		workersDev: false,
		previewUrls: false,
		assets: {
			htmlHandling: "auto-trailing-slash",
			notFoundHandling: "404-page",
		},
		domains: [
			"filmie.sayed.app",
		],
	},
});
