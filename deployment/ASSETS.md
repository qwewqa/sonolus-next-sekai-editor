# Release preview packages

`assets/skin.scp` and `assets/particle.scp` are version-controlled copies of the
exact packages used by the preview tests and manual review. They are intentionally
separate from the ignored `public/resource` directory, where developers can use
their own packages. `preview-assets.json` pins their size and SHA-256 digest.

The packages were copied from the reviewed local preview resource set on
2026-09-16. Neither package contains a license file, and the repository's MIT
license should not be presented as a license for these resources. Their embedded
metadata identifies the skin as **Next SEKAI 01** and the particles as
**Next SEKAI**, attributed to **Burrito#1000**. Skin metadata lists collaborator
**qwewqa#590353** and particles list **Hyeon2#7895**. Attribution and source information
remain with the released files in `ASSET_NOTICES.txt`.

The package info records a download from <https://coconut.sonolus.com/next-sekai>
at `2026-09-16T04:30:45.997342+00:00`. Their data, texture and thumbnail payloads
match the public [skin item](https://coconut.sonolus.com/next-sekai/sonolus/skins/coconut-next-sekai-1)
and [particle item](https://coconut.sonolus.com/next-sekai/sonolus/particles/coconut-next-sekai-1)
byte for byte. These links document provenance; the build uses the pinned local
copies and does not depend on the current server contents.

To update a package, replace its copy here, update the size and SHA-256 digest in
`preview-assets.json`, review its attribution, and run the release checks and
production preview smoke test. Both the bytes and manifest belong in the same
commit. Do not copy the unused `next-sekai-resources.scp` aggregate into a release.

`node scripts/build-release.mjs` stages only the chosen packages, favicon,
thumbnail and notices in a temporary public directory. It builds `dist`, writes
`release-manifest.json`, and checks every output against an allowlist and recorded
hashes. The normal developer `public` directory is never modified.
