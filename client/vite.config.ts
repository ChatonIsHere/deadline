import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    root: __dirname,
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@shared': resolve(__dirname, '../src/shared'),
        },
    },
    // Emoji and logo, shared with the bot
    publicDir: resolve(__dirname, '../assets'),
    build: {
        outDir: resolve(__dirname, '../dist/client'),
        emptyOutDir: true,
        chunkSizeWarningLimit: 800,
    },
});
