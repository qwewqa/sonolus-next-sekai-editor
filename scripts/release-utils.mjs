import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

export const staticFiles = ['favicon.ico', 'thumbnail.png']
export const noticeFiles = [
    'LICENSE.txt',
    'ASSET_NOTICES.txt',
    'THIRD_PARTY_NOTICES.txt',
    'notices/LGPL-3.0.txt',
    'notices/GPL-3.0.txt',
    'notices/Font-Awesome.txt',
]

export function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex')
}

export function containedPath(directory, relative) {
    const target = resolve(directory, relative)
    if (!target.startsWith(resolve(directory) + sep)) {
        throw new Error(`Path is outside its release directory: ${relative}`)
    }
    return target
}

async function regularFile(path) {
    if (!(await lstat(path)).isFile()) {
        throw new Error(`Expected a regular release file: ${path}`)
    }
    return readFile(path)
}

export async function readAssetManifest(root) {
    const manifest = JSON.parse(
        await readFile(join(root, 'deployment/preview-assets.json'), 'utf8'),
    )
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
        throw new Error('Unsupported preview asset manifest')
    }
    const expected = new Set(['resource/skin.scp', 'resource/particle.scp'])
    for (const asset of manifest.assets) {
        if (
            !expected.delete(asset.file) ||
            asset.source !== `deployment/assets/${asset.file.slice('resource/'.length)}` ||
            !Number.isSafeInteger(asset.bytes) ||
            asset.bytes <= 0 ||
            !/^[a-f0-9]{64}$/.test(asset.sha256)
        ) {
            throw new Error(`Invalid preview asset declaration: ${asset.file}`)
        }
    }
    if (expected.size) throw new Error('Preview asset manifest is incomplete')
    return manifest
}

export async function copyVerifiedAsset(root, destination, asset) {
    const bytes = await regularFile(containedPath(root, asset.source))
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) {
        throw new Error(`Preview asset integrity failed: ${asset.source}`)
    }
    const target = containedPath(destination, asset.file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
}

async function dependencyNotices(root) {
    const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
    const lamejs = JSON.parse(await readFile(join(root, 'deployment/lamejs-source.json'), 'utf8'))
    if (lock.packages[`node_modules/${lamejs.package}`]?.version !== lamejs.version) {
        throw new Error('Update LameJS source attribution for the locked dependency version')
    }
    const sections = [
        'Third-party software notices',
        '============================',
        '',
        'This list includes production dependencies and their build helpers.',
        'Versions and original license text are taken from the locked installation.',
        '',
        'LameJS: @breezystack/lamejs is used without source modifications.',
        'It is compiled as a separate dynamically imported JavaScript chunk.',
        'LAME project: https://lame.sourceforge.io/',
        `Published package source: ${lamejs.repository}/tree/${lamejs.commit}`,
        `Corresponding source archive: ${lamejs.archive}`,
        `Source archive SHA-256: ${lamejs.archiveSha256}`,
        'Upstream source: https://github.com/zhuker/lamejs',
        'Full LGPL-3.0 and GPL-3.0 texts are included in notices/.',
        'The published package LICENSE excerpt is also preserved below.',
        '',
        'Font Awesome icon attribution: notices/Font-Awesome.txt',
        'Preview resource attribution: ASSET_NOTICES.txt',
    ]
    for (const [location, locked] of Object.entries(lock.packages).sort(([a], [b]) =>
        a.localeCompare(b),
    )) {
        if (!location || locked.dev || locked.optional) continue
        if (!location.startsWith('node_modules/'))
            throw new Error(`Unexpected dependency path: ${location}`)
        const directory = containedPath(root, location)
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        if (pkg.version !== locked.version)
            throw new Error(`Dependency version differs from lockfile: ${pkg.name}`)
        const licenses = (await readdir(directory))
            .filter((file) => /^(licen[sc]e|copying)(\.|$)/i.test(file))
            .sort()
        if (!licenses.length) throw new Error(`Missing dependency license: ${pkg.name}`)
        sections.push(
            '',
            `${pkg.name} ${pkg.version}`,
            `License: ${pkg.license ?? locked.license ?? 'See text below'}`,
        )
        const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
        if (repository) sections.push(`Source: ${repository}`)
        for (const file of licenses)
            sections.push('', (await regularFile(join(directory, file))).toString('utf8').trim())
    }
    return sections.join('\n') + '\n'
}

export async function stageReleasePublic(root, destination, manifest) {
    await mkdir(destination, { recursive: true })
    for (const file of staticFiles) {
        await writeFile(join(destination, file), await regularFile(join(root, 'public', file)))
    }
    for (const asset of manifest.assets) await copyVerifiedAsset(root, destination, asset)
    await writeFile(join(destination, 'LICENSE.txt'), await regularFile(join(root, 'LICENSE.txt')))
    await writeFile(
        join(destination, 'ASSET_NOTICES.txt'),
        await regularFile(join(root, 'deployment/ASSET_NOTICES.txt')),
    )
    await mkdir(join(destination, 'notices'), { recursive: true })
    for (const file of noticeFiles.filter((file) => file.startsWith('notices/'))) {
        await writeFile(join(destination, file), await regularFile(join(root, 'deployment', file)))
    }
    await writeFile(join(destination, 'THIRD_PARTY_NOTICES.txt'), await dependencyNotices(root))
}

async function listFiles(directory, prefix = '') {
    const files = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name
        if (entry.isDirectory())
            files.push(...(await listFiles(join(directory, entry.name), relative + '/')))
        else if (entry.isFile()) files.push(relative)
        else throw new Error(`Non-regular release entry: ${relative}`)
    }
    return files.sort()
}

function validateFileNames(files, assets) {
    const exact = new Set([
        'index.html',
        'release-manifest.json',
        ...staticFiles,
        ...noticeFiles,
        ...assets.map((asset) => asset.file),
    ])
    for (const file of files) {
        if (
            !exact.has(file) &&
            !/^assets\/[\w.-]+-[\w-]{8,}\.(?:js|css|png|mp3|svg|woff2?)$/.test(file)
        ) {
            throw new Error(`Unexpected release file: ${file}`)
        }
    }
    for (const file of exact) {
        if (file !== 'release-manifest.json' && !files.includes(file)) {
            throw new Error(`Missing release file: ${file}`)
        }
    }
    if (!files.some((file) => /^assets\/.+\.js$/.test(file)))
        throw new Error('Release contains no JavaScript bundle')
    if (!files.some((file) => /^assets\/.+\.css$/.test(file)))
        throw new Error('Release contains no stylesheet')
}

export async function writeReleaseManifest(directory, metadata, assets) {
    const files = (await listFiles(directory)).filter((file) => file !== 'release-manifest.json')
    validateFileNames(files, assets)
    const hashes = {}
    for (const file of files) hashes[file] = sha256(await regularFile(join(directory, file)))
    const manifest = { schemaVersion: 1, ...metadata, previewAssets: assets, files: hashes }
    await writeFile(
        join(directory, 'release-manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
    )
    return manifest
}

export async function checkRelease(directory, assets, expected = {}) {
    const manifest = JSON.parse(await regularFile(join(directory, 'release-manifest.json')))
    if (
        manifest.schemaVersion !== 1 ||
        !/^[a-f0-9]{40}$/.test(manifest.commit) ||
        typeof manifest.version !== 'string' ||
        !manifest.version ||
        manifest.base !== '/' ||
        manifest.appVersion !== `${manifest.version}+${manifest.commit.slice(0, 8)}` ||
        typeof manifest.sourceDirty !== 'boolean' ||
        JSON.stringify(manifest.previewAssets) !== JSON.stringify(assets)
    )
        throw new Error('Invalid release metadata')
    for (const [key, value] of Object.entries(expected)) {
        if (manifest[key] !== value) throw new Error(`Release metadata mismatch: ${key}`)
    }
    const files = await listFiles(directory)
    validateFileNames(files, assets)
    const recorded = Object.keys(manifest.files).sort()
    if (
        JSON.stringify(recorded) !==
        JSON.stringify(files.filter((file) => file !== 'release-manifest.json'))
    ) {
        throw new Error('Release file inventory differs from its manifest')
    }
    for (const file of recorded) {
        if (sha256(await regularFile(join(directory, file))) !== manifest.files[file]) {
            throw new Error(`Release file integrity failed: ${file}`)
        }
    }
    for (const asset of assets) {
        const bytes = await regularFile(join(directory, asset.file))
        if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) {
            throw new Error(`Preview asset integrity failed: ${asset.file}`)
        }
    }
    return manifest
}
