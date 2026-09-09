// @gains/eslint-config — shared ESLint 9 flat config for Gains TypeScript services.
// strictTypeChecked + stylisticTypeChecked (type-aware), the correctness rules that protect
// fund-touching code, and strict COMMENT/DOC hygiene (jsdoc + tsdoc). Consumers extend this and
// set their own tsconfigRootDir if projectService needs help locating tsconfig.
// Docs: https://typescript-eslint.io/users/configs/ · https://github.com/gajus/eslint-plugin-jsdoc · https://tsdoc.org/
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";
import tsdoc from "eslint-plugin-tsdoc";

export default tseslint.config(
  { ignores: ["dist", "build", "coverage", "node_modules", "**/*.generated.ts"] },

  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      // Type-aware linting; projectService auto-resolves the nearest tsconfig per file.
      parserOptions: { projectService: true },
    },
    rules: {
      // Correctness rules that guard signing / settlement / pricing paths.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // No `as` casts (except `as const`); parse-don't-validate instead.
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },

  // ── Comment hygiene: ALL TypeScript. Kills rot/noise the type system already contradicts. ──
  // The gate is `eslint --max-warnings=0`, so `warn` still blocks CI (ratchet via eslint-suppressions).
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { jsdoc, tsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      "tsdoc/syntax": "warn", // TSDoc must parse (undeclared/misspelled tags, malformed structure)
      "jsdoc/no-types": "error", // TS owns shapes; {type} braces in a .ts doc are pure rot
      "jsdoc/check-param-names": "error", // a @param naming a nonexistent arg is a lie after refactor
      "jsdoc/no-blank-blocks": "warn", // empty /** */ stubs
      "jsdoc/informative-docs": "warn", // a doc that merely restates the identifier adds nothing
      "jsdoc/check-alignment": "warn",
      // If a @param/@returns/@throws IS written its prose must be non-empty — but we do NOT force the tag
      // (forcing a @param line per arg on a typed signature is noise).
      "jsdoc/require-param-description": "warn",
      "jsdoc/require-returns-description": "warn",
    },
  },

  // ── Doc PRESENCE + content: the EXPORTED public API of the two SDK packages ONLY. ──
  {
    files: ["packages/sdk/src/**/*.ts", "packages/trading-sdk/src/**/*.ts"],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      "jsdoc/require-jsdoc": [
        "warn",
        {
          publicOnly: { esm: true, cjs: false, ancestorsOnly: true },
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: false, // noisy on private methods
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
          // publicOnly does not reliably filter `contexts`, so gate exported types on the export node
          // explicitly — internal interfaces/types stay noise-free.
          contexts: [
            "ExportNamedDeclaration > TSInterfaceDeclaration",
            "ExportNamedDeclaration > TSTypeAliasDeclaration",
            "ExportNamedDeclaration > TSEnumDeclaration",
          ],
          checkConstructors: false,
          exemptEmptyFunctions: true,
          enableFixer: false, // auto-inserted empty /** */ stubs immediately become rot
        },
      ],
      "jsdoc/require-description": ["warn", { contexts: ["any"] }],
      "jsdoc/require-throws": "warn", // thrown errors are part of the SDK contract; TS sigs don't encode them
    },
  },

  // ── Fund-touching paths: escalate safety docs to ERROR (real dirs in packages/sdk). ──
  {
    files: [
      "packages/sdk/src/pricing/**/*.ts",
      "packages/sdk/src/trade/**/*.ts", // includes trade/liquidation
      "packages/sdk/src/vault/**/*.ts",
      // extend as signing/settlement/funding dirs land — keep this list explicit, not a broad glob.
    ],
    rules: {
      "jsdoc/require-throws": "error",
      "jsdoc/require-description": "error",
      "tsdoc/syntax": "error",
    },
  },

  // ── Tests / scripts: doc rules OFF (self-documenting, high churn). ──
  {
    files: ["**/*.{test,spec}.ts", "**/tests/**/*.ts", "**/test/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-throws": "off",
      "tsdoc/syntax": "off",
    },
  },

  // JS/config files: no type-aware rules.
  { files: ["**/*.js", "**/*.cjs", "**/*.mjs"], ...tseslint.configs.disableTypeChecked },
);
