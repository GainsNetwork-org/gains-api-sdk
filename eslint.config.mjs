import gains from "./eslint.shared.mjs";

export default [
  { ignores: ["src/generated/**", "dist/**"] },
  ...gains,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];
