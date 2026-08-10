"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vite_1 = __importDefault(require("@tailwindcss/vite"));
const plugin_react_1 = __importDefault(require("@vitejs/plugin-react"));
const path_1 = __importDefault(require("path"));
const vite_2 = require("vite");
exports.default = (0, vite_2.defineConfig)(() => {
    return {
        plugins: [(0, plugin_react_1.default)(), (0, vite_1.default)()],
        resolve: {
            alias: {
                '@': path_1.default.resolve(__dirname, '.'),
            },
        },
        server: {
            // HMR is disabled in AI Studio via DISABLE_HMR env var.
            // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
            hmr: process.env.DISABLE_HMR !== 'true',
            // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
            watch: process.env.DISABLE_HMR === 'true' ? null : {},
        },
    };
});
