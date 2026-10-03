import { SkinSpriteName } from '@sonolus/core'
import { gzipSync } from 'node:zlib'

// Tiny in-memory packages keep these tests independent of optional local skins.
const archive = (entries: Record<string, Buffer>) => {
    const local: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const [name, data] of Object.entries(entries)) {
        const filename = Buffer.from(name)
        const header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50, 0)
        header.writeUInt32LE(data.length, 18)
        header.writeUInt32LE(data.length, 22)
        header.writeUInt16LE(filename.length, 26)
        local.push(header, filename, data)

        const directory = Buffer.alloc(46)
        directory.writeUInt32LE(0x02014b50, 0)
        directory.writeUInt32LE(data.length, 20)
        directory.writeUInt32LE(data.length, 24)
        directory.writeUInt16LE(filename.length, 28)
        directory.writeUInt32LE(offset, 42)
        central.push(directory, filename)
        offset += header.length + filename.length + data.length
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(Object.keys(entries).length, 8)
    end.writeUInt16LE(Object.keys(entries).length, 10)
    end.writeUInt32LE(
        central.reduce((length, part) => length + part.length, 0),
        12,
    )
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...local, ...central, end])
}

const texture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
    'base64',
)
export const resource = (kind: 'skins' | 'particles') =>
    archive({
        [`sonolus/${kind}/list`]: Buffer.from(
            JSON.stringify({
                items: [
                    {
                        name: 'fixture',
                        title: 'Fixture',
                        data: { url: '/data' },
                        texture: { url: '/texture' },
                    },
                ],
            }),
        ),
        data: gzipSync(
            JSON.stringify({
                width: 1,
                height: 1,
                interpolation: true,
                effects: [],
                sprites:
                    kind === 'particles'
                        ? []
                        : Object.values(SkinSpriteName).map((name) => ({
                              name,
                              x: 0,
                              y: 0,
                              w: 1,
                              h: 1,
                              transform: Object.fromEntries(
                                  ['x1', 'x2', 'x3', 'x4', 'y1', 'y2', 'y3', 'y4'].map((key) => [
                                      key,
                                      { [key]: 1 },
                                  ]),
                              ),
                          })),
            }),
        ),
        texture,
    })
