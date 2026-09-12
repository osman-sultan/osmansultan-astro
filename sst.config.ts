/// <reference path="./.sst/platform/config.d.ts" />

// Personal AWS account only. The profile below must never point at a work
// account; `sst deploy --stage production` uses it directly. AWS_PROFILE in the
// environment overrides this value, so keep that variable unset.
const AWS_PROFILE = "osman-personal"

export default $config({
  app(input) {
    return {
      name: "osmansultan",
      // Production resources survive `sst remove`; preview stages are cleaned up.
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          profile: AWS_PROFILE,
          region: "us-east-1",
        },
      },
    }
  },
  async run() {
    const site = new sst.aws.Astro("Site", {
      // The site is static (see astro.config.mjs), so this is S3 + CloudFront
      // with no Lambda. `warm` and other server options do not apply.
      buildCommand: "bun run build",
      // Custom domain is attached only to production once DNS is confirmed:
      // domain: { name: "osmansultan.me", redirects: ["www.osmansultan.me"] },
    })

    return { url: site.url }
  },
})
