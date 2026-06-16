import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // PayCraft brand — refined violet ramp tuned for SaaS dashboards.
        brand: {
          50: "#F5F3FF",
          100: "#EDE9FE",
          200: "#DDD6FE",
          300: "#C4B5FD",
          400: "#A78BFA",
          500: "#8B5CF6",
          600: "#7C3AED",
          700: "#6D28D9",
          800: "#5B21B6",
          900: "#4C1D95",
        },
        // Semantic neutrals — based on the Vercel / Linear neutral ramp.
        ink: {
          50: "#FAFAFA",
          100: "#F4F4F5",
          200: "#E4E4E7",
          300: "#D4D4D8",
          400: "#A1A1AA",
          500: "#71717A",
          600: "#52525B",
          700: "#3F3F46",
          800: "#27272A",
          900: "#18181B",
          950: "#09090B",
        },
        // Status colors.
        success: { 50: "#F0FDF4", 100: "#DCFCE7", 500: "#22C55E", 600: "#16A34A", 700: "#15803D" },
        warning: { 50: "#FFFBEB", 100: "#FEF3C7", 500: "#F59E0B", 600: "#D97706", 700: "#B45309" },
        danger:  { 50: "#FEF2F2", 100: "#FEE2E2", 500: "#EF4444", 600: "#DC2626", 700: "#B91C1C" },
        info:    { 50: "#EFF6FF", 100: "#DBEAFE", 500: "#3B82F6", 600: "#2563EB", 700: "#1D4ED8" },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "monospace",
        ],
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs:   ["0.75rem",   { lineHeight: "1.125rem" }],
        sm:   ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg:   ["1.0625rem", { lineHeight: "1.625rem" }],
        xl:   ["1.25rem",   { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem",   { lineHeight: "2rem",    letterSpacing: "-0.01em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.25rem",  { lineHeight: "2.5rem",  letterSpacing: "-0.03em" }],
      },
      boxShadow: {
        xs:    "0 1px 1px 0 rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.04)",
        sm:    "0 1px 2px 0 rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.04)",
        md:    "0 4px 8px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05)",
        lg:    "0 12px 24px -8px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05)",
        xl:    "0 24px 48px -12px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06)",
        focus: "0 0 0 3px rgba(124, 58, 237, 0.18)",
      },
      animation: {
        "fade-in":    "fadeIn 0.18s ease-out",
        "slide-up":   "slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.55" },
        },
      },
    },
  },
  plugins: [],
}

export default config
