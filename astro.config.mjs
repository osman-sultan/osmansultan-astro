// @ts-check

import tailwindcss from "@tailwindcss/vite"
import { defineConfig, fontProviders } from "astro/config"
import react from "@astrojs/react"
import sitemap from "@astrojs/sitemap"
import aws from "astro-sst"

// https://astro.build/config
export default defineConfig({
  // Canonical origin; used for the sitemap, canonical links and Open Graph URLs.
  site: "https://osmansultan.xyz",
  // Static output (the default); astro-sst only writes the build metadata SST
  // needs to deploy dist/ to S3 + CloudFront. No Lambda is created.
  output: "static",
  adapter: aws(),
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [react(), sitemap()],
  fonts: [
    {
      // Prince of Persia display font, used only for the home page hero.
      provider: fontProviders.local(),
      name: "Prince of Persia",
      cssVariable: "--font-prince-of-persia",
      fallbacks: ["serif"],
      options: {
        variants: [
          {
            weight: 400,
            style: "normal",
            src: ["./src/assets/fonts/princeofpersia.ttf"],
          },
        ],
      },
    },
  ],
})
