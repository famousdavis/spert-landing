// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0. See LICENSE file in the project root for full license text.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Built output and files outside the typed project.
  {ignores: ["lib/**", "generated/**", "eslint.config.mjs", "jest.config.js"]},
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: ["tsconfig.json", "tsconfig.dev.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Deliberate project style, carried over from the previous eslintrc.
      // The rest of eslint-config-google's formatting rules were dropped in
      // v2.5.2 to match the other SPERT repos, which enforce no formatting.
      "quotes": ["error", "double"],
      "indent": ["error", 2],
    },
  },
);
