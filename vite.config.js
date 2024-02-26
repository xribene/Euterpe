import {fileURLToPath, URL} from 'node:url';
import {defineConfig} from 'vite';
import legacy from '@vitejs/plugin-legacy';
import vue2 from '@vitejs/plugin-vue2';
import yaml from '@rollup/plugin-yaml';
// import mdPlugin, { Mode } from 'vite-plugin-markdown';
import {plugin as mdPlugin, Mode} from 'vite-plugin-markdown';


// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        vue2(),
        yaml(),
        mdPlugin({
            mode: [Mode.HTML, Mode.TOC, Mode.MARKDOWN], // Specify the modes you need
            // Additional options here
        }),
        legacy({
            targets: ['ie >= 11'],
            additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
        }),
        {
            name: 'configure-response-headers',
            configureServer: (server) => {
                server.middlewares.use((_req, res, next) => {
                    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
                    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                    next();
                });
            },
        },
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
});
