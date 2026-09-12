/// <reference path="./.sst/platform/config.d.ts" />

// Personal AWS account only. The profile below must never point at a work
// account; `sst deploy --stage production` uses it directly. AWS_PROFILE in the
// environment overrides this value, so keep that variable unset.
// On SST Console Autodeploy (AWS CodeBuild) there is no local profile; the
// build role supplies credentials, so the profile is left undefined there.
const AWS_PROFILE = process.env.CODEBUILD_BUILD_ID ? undefined : "osman-personal"

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
      async workflow({ $, event }) {
        await $`curl -fsSL https://bun.sh/install | bash`
        process.env.PATH = `${process.env.HOME}/.bun/bin:${process.env.PATH}`
        await $`bun install --frozen-lockfile`
        if (event.action === "removed") {
          await $`bunx sst remove`
        } else {
          await $`bunx sst deploy`
        }
      },
    },
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
