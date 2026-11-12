import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['src/bindings/**']},js.configs.recommended,...tseslint.configs.recommended,{files:['src/**/*.{ts,tsx}'],rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-non-null-assertion':'error','no-restricted-imports':['error',{patterns:[{group:['@tauri-apps/api/core'],message:'Only generated bindings may invoke commands.'}]}]}},{files:['scripts/*.mjs'],languageOptions:{globals:{console:'readonly',process:'readonly',URL:'readonly'}}});
