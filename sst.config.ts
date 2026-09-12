/// <reference path="./.sst/platform/config.d.ts" />

// Personal AWS account only. The profile below must never point at a work
// account; `sst deploy --stage production` uses it directly. AWS_PROFILE in the
// environment overrides this value, so keep that variable unset.
// SST Console Autodeploy sets SST_AWS_NO_PROFILE, which makes SST ignore this
// value and use the build role instead, so it is safe to set unconditionally.
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
  console: {
    autodeploy: {
      // SST Console runs these on AWS CodeBuild in the personal account.
      // Pushes to main deploy production; pull requests get a pr-<n> preview
      // stage that is removed when the PR closes.
      target(event) {
        if (
          event.type === "branch" &&
          event.branch === "main" &&
          event.action === "pushed"
        ) {
          return { stage: "production" }
        }
        if (event.type === "pull_request") {
          return { stage: `pr-${event.number}` }
        }
      },
      // The default runner installs with npm, but this repo only has bun.lock.
      // Same shape as the docs' pnpm example: install the package manager
      // globally, then use it. SST_STAGE is already set in the build.
      async workflow({ $, event }) {
        await $`npm i -g bun`
        await $`bun install --frozen-lockfile`
        if (event.action === "removed") {
          await $`bun sst remove`
        } else {
          await $`bun sst deploy`
        }
      },
    },
  },
  async run() {
    const site = new sst.aws.Astro("Site", {
      // The site is static (see astro.config.mjs), so this is S3 + CloudFront
      // with no Lambda. `warm` and other server options do not apply.
      buildCommand: "bun run build",
      // osmansultan.xyz is registered in Route 53 on the personal account, so
      // SST creates the certificate and DNS records itself. Preview stages stay
      // on their CloudFront URLs.
      domain:
        $app.stage === "production"
          ? { name: "osmansultan.xyz", redirects: ["www.osmansultan.xyz"] }
          : undefined,
    })

    return { url: site.url }
  },
})
