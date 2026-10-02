import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules/', 'coverage/', '.claude-plugin/types/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Pane rows separate their columns with two spaces, which tests match as written.
    files: ['tests/**/*.ts'],
    rules: { 'no-regex-spaces': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
)
