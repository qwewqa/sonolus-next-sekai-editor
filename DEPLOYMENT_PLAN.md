Public deployment plan — 2026-09-16

Use **GitHub Pages** for the first public release. This editor is a static browser
application; chart files, audio processing and autosave do not require an
application server. AWS becomes useful if traffic or requirements for cache and
header control justify the extra infrastructure.

The reviewed application commit is **`f707dd9`**. It passes 139 unit tests and
93 browser tests, type checking, lint and source formatting. Native Firefox
155.0.1 checks passed, including fractional-DPR waveform rendering and save
cancellation. Production smoke tests passed at both `/` and
`/sonolus-next-sekai-editor/`, using real preview packages and normal import,
editing, FFT, playback and save flows. Follow-up review found no remaining
actionable defects in the changed paths. The headless rendering measurements
do not establish frame rates on every hardware GPU.

Publish from the **`preview` branch** of
[`qwewqa/sonolus-next-sekai-editor`](https://github.com/qwewqa/sonolus-next-sekai-editor)
at **`https://next-sekai-editor-test.qwewqa.xyz/`**. The publishing repository
currently has only `main`, so `preview` is available for the reviewed changes.
The public preview asset set still needs to be selected during implementation.

1. **Prepare a reproducible release build.**

    Build from a clean checkout of a reviewed commit with `npm ci`. Pin the Node
    version and validate that version in CI: existing workflows use Node 22,
    while this local review used Node 26.5.0. If retaining Node 22, use an exact
    supported version at least 22.12 and run the complete release checks there.
    Add the production build and browser checks to the existing CI coverage;
    type/lint/format workflows currently only target `main`.

    Add a publishing remote for `qwewqa/sonolus-next-sekai-editor`, preserving the
    existing remotes. Verify Actions is enabled in this fork before its first
    release push. Prepare the Pages workflow on the reviewed local `preview`
    branch and publish that branch when deployment is authorized. Trigger releases
    on pushes to `preview`; other branches and pull requests run checks only.
    This permits the first workflow run without changing the default `main`
    branch. Do not depend on `workflow_dispatch` for bootstrap: GitHub requires
    the workflow on the default branch for that trigger's initial availability.
    [GitHub workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

    Give the release its own version and record its full Git SHA in an artifact
    manifest. Update the current Cloudflare-only version metadata logic so GitHub
    builds expose useful release provenance.

2. **Make the public asset set explicit.**

    A clean checkout has no skin package, so its 3D preview cannot load. Supply a
    selected `public/resource/skin.scp` and, if desired, `particle.scp` from a
    versioned, checksum-verified source. Record which packages are intended for
    public redistribution; the local packages do not include clear redistribution
    terms. Keep the project license and relevant dependency/media attribution in
    the release, including source/license information for the LameJS dependency.

    The current local build also copies an unused 4,851,251-byte
    `next-sekai-resources.scp`. Exclude that aggregate package and the development
    resource README from the release. Publish only the generated `dist` artifact.
    Add an artifact check allowing only the chosen resource packages and rejecting
    unexpected files. Git ignore rules do not prevent Vite from copying files in
    `public` to the build output. [Vite public asset handling](https://vite.dev/guide/assets.html)

3. **Configure Pages and the custom hostname before the first release.**

    Select **GitHub Actions** as the publishing source in the target repository's
    Pages settings. In the `github-pages` environment, set **Deployment branches
    and tags → Selected branches and tags → Branch: `preview`** as the only allowed
    deployment source. [GitHub environment configuration](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

    Set the Pages custom domain to
    `next-sekai-editor-test.qwewqa.xyz`, then add this DNS record in `qwewqa.xyz`:

    | Type  | Name                     | Target             |
    | ----- | ------------------------ | ------------------ |
    | CNAME | `next-sekai-editor-test` | `qwewqa.github.io` |

    Set the domain in Pages before changing DNS. Wait for the domain check and
    certificate provisioning, then enable **Enforce HTTPS**. With Actions-based
    publishing, Pages settings control the domain; a `CNAME` file is not required
    and is ignored. [GitHub Pages custom-domain setup](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

    This hostname serves the app at the root. Build with:

    ```sh
    npm run build -- --base=/
    ```

    The production root smoke already passed with real preview packages. Update
    `og:url` to `https://next-sekai-editor-test.qwewqa.xyz/` and `og:image` to
    `https://next-sekai-editor-test.qwewqa.xyz/thumbnail.png` in `index.html`; both
    currently point to the upstream site. Add a small release manifest containing
    the SHA, version, build base and package hashes.
    [Vite's GitHub Pages instructions](https://vite.dev/guide/static-deploy.html#github-pages)

4. **Gate deployment on checks and a production smoke test.**

    The release build job should run these checks from the clean checkout:

    ```sh
    npm ci
    npm test
    npm run check-type
    npm run check-lint
    npm run check-format
    npx playwright install --with-deps chromium
    npm run test:browser
    npm run build -- --base=/
    ```

    Install the selected assets before the production build. Commit a small
    production smoke harness that serves the resulting artifact at `/` and checks
    imports, editing, saving, FFT, preview controls and idle rendering. Existing
    Playwright tests primarily use Vite's development
    server; the production checks performed during review currently live outside
    the repository and should become repeatable release checks.

    Run lint before Playwright in a shared job, or use separate checkout jobs:
    Playwright recreates `test-results`, which can race ESLint's directory scan.
    Upload only the checked `dist` using `actions/upload-pages-artifact`. Make the
    deploy job depend on that build job, use the `github-pages` environment, and
    give it `pages: write` and `id-token: write`. Use `actions/configure-pages` and
    `actions/deploy-pages`, pinned to reviewed versions. Keep ordinary pull
    requests as check-only runs. Serialize the entire release workflow with a
    shared concurrency group and `cancel-in-progress: false` so overlapping
    releases cannot race or interrupt an active deployment. [GitHub Pages custom workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

5. **Launch an initial public beta and verify the hosted URL.**

    Deploy the passing artifact, then test
    `https://next-sekai-editor-test.qwewqa.xyz/` before announcing it broadly.
    Verify fresh loading and reload, package/audio requests, chart import/save/reopen,
    BGM and FFT generation, cancellation, all aspect
    presets, quality/resize, autosave recovery, and paused/unfocused rendering.
    Use both Chromium and Firefox; check scrolling and playback on a real GPU as
    well as the automated software renderer. Confirm the editor remains usable
    when optional particles are absent.

    This hostname is the shared public test site. Standard Pages deployment does
    not provide a separate public preview URL for every pull request. Use the
    local production rehearsal for release candidates.
    [Current Pages deployment action](https://github.com/actions/deploy-pages)

    Document export/reopen for users moving from localhost or another editor
    hostname: settings and autosave belong to the old browser origin and do not
    migrate automatically.

6. **Retain a tested rollback path.**

    Set artifact retention explicitly, for example 30 days; the Pages upload
    action's default retention is only one day. Keep at least the previous two
    complete release archives with their manifests and matching preview assets.
    Restore the selected prior source and pinned asset manifest as a new commit
    on `preview`, preserving branch history, then run the normal checks and
    deployment. Exercise that path once before broad launch. An archive-based
    redeploy can be added later if faster recovery is needed; validate artifact
    retrieval and workflow activation before relying on it. Verify the previous
    release can reopen charts saved by the new one; an application rollback does not undo
    changes to users' local files or storage. [Pages artifact retention](https://github.com/actions/upload-pages-artifact)

7. **Move to AWS only when there is a concrete reason.**

    The inspected build is under 9 MB even before removing the unused package,
    comfortably below Pages' 1 GB site limit. Track demand against its current
    100 GB/month soft bandwidth limit. Larger traffic or a need for custom
    caching/response headers would be reasons to reconsider hosting.
    [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

    The AWS alternative is a private S3 bucket behind CloudFront, with Origin
    Access Control, HTTPS, `index.html` as the default root object, and a certificate
    for any custom domain. Use the regular S3 bucket origin; an S3 website endpoint
    does not support OAC. Retain versioned release artifacts, give hashed assets
    long cache lifetimes, and revalidate entry HTML and fixed-name resource
    packages. Apply the same release checks and rollback process. This does not
    require EC2 or an application server.
    [CloudFront's S3 origin access guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)

Implementation deliverables are a Pages workflow, pinned asset manifest and
artifact check, production smoke test, updated URL/version metadata, release
notices, and a tested rollback procedure. Hosting configuration and publication
remain pending; this review did not change repository settings or deploy a site.
