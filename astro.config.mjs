// @ts-check

import tailwindcss from "@tailwindcss/vite"
import { defineConfig, fontProviders } from "astro/config"
import react from "@astrojs/react"

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [react()],
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
