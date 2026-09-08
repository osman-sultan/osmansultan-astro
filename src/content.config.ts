import { file } from "astro/loaders"
import { z } from "astro/zod"
import { defineCollection } from "astro:content"

// Projects live in one JSON file; each entry needs a unique `id`. Images are
// paths relative to that file and are validated and optimised by Astro.
const projects = defineCollection({
  loader: file("src/data/projects.json"),
  schema: ({ image }) =>
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(["ml/ai", "web", "algorithms", "ui/ux"]),
      description: z.string(),
      date: z.string(),
      group: z.enum(["recent", "earlier"]),
      image: image(),
      link: z.url(),
    }),
})

export const collections = { projects }
