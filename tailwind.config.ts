import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F5F6F8",
        ink: "#16213A",
        mute: "#5B6478",
        line: "#DDE1E8",
        verified: "#1B7F4D",
        unverified: "#B45309",
        accent: "#2B4C9B",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
