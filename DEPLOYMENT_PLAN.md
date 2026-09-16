GitHub Pages deployment — 2026-09-16

The public test site is **https://next-sekai-editor-test.qwewqa.xyz/**, published
from **`preview`** in
[`qwewqa/sonolus-next-sekai-editor`](https://github.com/qwewqa/sonolus-next-sekai-editor).
The editor is a static application; chart files, audio processing, settings and
autosave remain in the browser and do not need a backend.

1. **Release by pushing to `preview`.**

    `.github/workflows/deploy-pages.yml` runs automatically for pushes to
    `preview` and pull requests targeting it. The build uses Node from
    `.node-version`, `npm ci`, and action versions pinned to commit SHAs. It runs
    unit and release-integrity tests, type/lint/format checks, the editor browser
    suite, a production build, the production browser smoke test, and a final
    artifact check.

    Only a push to `preview` in the publishing repository can upload and deploy
    the checked site. Pull requests have read-only permissions and cannot deploy.
    The deploy job alone receives Pages write and OpenID Connect permissions.
    Releases are serialized without interrupting an active deployment; a newer
    pending run can replace an older pending run. No manual workflow dispatch or
    default-branch change is needed. Inspect runs in
    [Actions](https://github.com/qwewqa/sonolus-next-sekai-editor/actions/workflows/deploy-pages.yml).

    If a run fails, fix the failure and push, or use **Re-run failed jobs** on that
    run after resolving an external configuration problem. A successful test-only
    workflow does not publish anything; the **Deploy Pages** workflow must pass
    its deploy job. [Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

2. **Build from the versioned release assets.**

    `npm run build:release` stages an explicit public file set and builds at `/`,
    the root of the custom hostname. It uses the exact reviewed skin and particle
    packages committed under `deployment/assets`, with sizes and SHA-256 hashes
    recorded in `deployment/preview-assets.json`. It does not use or modify the
    developer's `public/resource` packages. The unused aggregate package, local
    charts and BGM are excluded.

    The build includes `release-manifest.json`, the project license, dependency
    license notices and asset attribution. The manifest records the source SHA,
    version, base and package hashes; the app's version notification includes the
    source SHA prefix. `npm run check:release` rejects unexpected or modified
    output files. See [asset provenance and updates](deployment/ASSETS.md).

    To rehearse a release locally, use the pinned Node version and run:

    ```sh
    npm ci
    npm test
    npm run test:release
    npm run check-type
    npm run check-lint
    npm run check-format
    npx playwright install chromium
    npm run test:browser
    npm run build:release
    npm run test:production
    npm run check:release
    ```

    Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an installed Chromium browser.
    Run lint before browser tests, since Playwright recreates its result directory.
    The production smoke uses a separate server on port 5211. Set
    `PRODUCTION_TEST_URL=https://next-sekai-editor-test.qwewqa.xyz/` to run the same
    smoke against the live site instead. It uses a fresh browser context and
    generated local chart/audio fixtures.

3. **Hosting settings are configured.**

    Verified on 2026-09-16: Actions is enabled, Pages uses the workflow publishing
    source, `github-pages` allows only the `preview` branch, and the custom domain
    has an approved certificate with HTTPS enforced. DNS resolves the expected
    CNAME. No additional manual setup is needed for this repository's first
    workflow deployment.

    If recreating the site, select **Settings → Pages → Source: GitHub Actions**.
    Under **Settings → Environments → github-pages**, choose **Selected branches
    and tags**, then add a **Branch** rule for `preview` only.
    [Environment settings](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

    Set the Pages custom domain to `next-sekai-editor-test.qwewqa.xyz` before
    adding this DNS record in `qwewqa.xyz`:

    | Type  | Name                     | Target             |
    | ----- | ------------------------ | ------------------ |
    | CNAME | `next-sekai-editor-test` | `qwewqa.github.io` |

    Enable **Enforce HTTPS** when certificate provisioning finishes. Actions-based
    Pages publishing uses the domain setting; a `CNAME` file is not required.
    [Custom domain and HTTPS setup](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

4. **Verify the hosted release.**

    Check the workflow's deployment URL and confirm `release-manifest.json`
    identifies the expected source commit. Run the hosted production smoke after
    the first deployment and after hosting changes. It exercises actual preview
    packages, import/edit/save, FFT, aspect ratios, playback and idle rendering.
    Check Firefox and a real hardware GPU as well for major rendering changes;
    software-rendered automation does not establish performance on every GPU.

    Users moving from localhost or another hostname should export and reopen
    charts: browser settings and autosave are scoped to the old origin and do not
    migrate automatically. This hostname is a shared test site; Pages does not
    create a separate public URL for each pull request.

5. **Roll back through a new release commit.**

    Revert the faulty changes or restore the previous known-good source and
    matching asset manifest/packages in a new commit on `preview`, then push.
    The normal checks rebuild and redeploy that version while preserving branch
    history. Retain the deployment workflow when reverting application changes.
    Validate that the prior version can reopen charts saved by the newer one;
    rolling back the app does not revert users' local files or storage.

    Checked Pages artifacts are retained for 30 days, and failed browser traces
    for seven days. Download release artifacts if a longer archive is needed.
    Keep the previous working release available when updating assets. Do not
    rely on re-running an old deploy job after its artifact has expired.
    [Artifact retention](https://github.com/actions/upload-pages-artifact)

GitHub Pages is sufficient for this small static application. If traffic or a
need for custom cache/response headers later warrants AWS, the corresponding
deployment is a private S3 bucket behind CloudFront with Origin Access Control
and HTTPS; no application server is needed. The same release artifact and checks
can be reused. [CloudFront S3 access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
