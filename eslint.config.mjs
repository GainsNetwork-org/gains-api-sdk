import gains from "@gains/eslint-config";

export default [
  { ignores: ["src/generated/**"] },
  ...gains,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];
