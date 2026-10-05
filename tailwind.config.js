/** @type {import('tailwindcss').Config} */
module.exports = {
    // Touch screens must not keep hover styles after a tap.
    future: {
        hoverOnlyWhenSupported: true,
    },
    content: ['./index.html', './src/**/*.vue', './src/**/*.ts'],
    theme: {
        extend: {
            colors: {
                fg: '#444466',
                bg: '#404464',
                button: '#fff',
                accent: '#77efdc',
                'on-accent': '#30334d',
                header: '#bcbcd1',
                // white/40 over header: hover on lavender bands, opaque so
                // sticky bands never show content scrolling beneath.
                'header-hover': '#d7d7e3',
                modal: '#e9ebef',
                preview: '#5b5c7c',
                // Destructive actions and errors (6.47:1 on white).
                danger: '#b91c1c',
            },
            boxShadow: {
                // The recessed track of a segmented control.
                track: 'inset 0 1px 2px rgb(48 51 77 / 0.2)',
                // A sticky band raised over content scrolled beneath it: a
                // hairline and a soft shadow.
                band: '0 1px 0 rgb(68 68 102 / 0.15), 0 6px 8px -6px rgb(68 68 102 / 0.35)',
            },
            width: {
                screen: ['100vw', '100dvw'],
            },
            height: {
                screen: ['100vh', '100dvh'],
            },
        },
    },
}
