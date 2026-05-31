import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#18201d",
        muted: "#5f6a66",
        panel: "#ffffff",
        line: "#dce4df",
        wash: "#f4f7f5",
        teal: "#087f70",
        coral: "#c2573c",
        gold: "#b57900"
      },
      boxShadow: {
        soft: "0 20px 60px rgba(24, 32, 29, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
