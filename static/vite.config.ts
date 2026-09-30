import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.md"],
  build: {
    rollupOptions: {
      output: {
        // 只显式拆分始终会用到的 React 运行时；
        // CodeMirror / markdown-it 等随路由懒加载，交给 Rollup 自动切分。
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
});
