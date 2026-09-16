# Sonolus Next SEKAI Editor

https://next-sekai-editor.sonolus.com

## Local preview

```sh
npm ci
npm run dev
```

The preview branch includes upstream editor 0.5.21 (`9b753b2`) and follows
`sonolus-next-sekai-engine` at `a338b98`. It supports quadratic timescale easing,
mixed timescale and scroll transitions, stage note masking, and stage elevation.

Place a skin package at `public/resource/skin.scp` and optionally a particle package
at `public/resource/particle.scp` to enable the preview. These local assets are
ignored by Git; see [preview packages](public/resource/README.md).

```sh
npm test
npm run check-type
npm run check-lint
npm run check-format
npm run build
```
