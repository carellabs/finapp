import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.stryker-tmp/**',
      'web/dev-dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // El dinero y las reglas de negocio no admiten escapatorias de tipos.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // JavaScript de tooling: fuera del programa de TypeScript, sin type-checking.
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },
  {
    // En un test, `filas[0]!` es una asercion deliberada: si no existe, el
    // test debe reventar ahi mismo y decir por que. En produccion sigue prohibida.
    files: ['**/tests/**/*.ts', '**/tests/**/*.tsx'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Service worker: contexto de navegador, no de Node.
    files: ['web/public/*.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
  },
  {
    // Scripts CLI en TypeScript (crear-usuario, importacion...): hablan con
    // el usuario por stdout, no solo con el log de errores.
    files: ['**/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Todo lo que la API escribe en el log pasa por `registrarEnConsola`
    // (`api/src/infra/registro.ts`), que redacta cookies, autorizacion, contrasenas e importes
    // por nombre de clave. Un `console.error` suelto en `src/` se saltaria esa proteccion
    // (security-engineering, regla 8): solo ese fichero puede escribir en la consola.
    files: ['api/src/**/*.ts'],
    ignores: ['api/src/infra/registro.ts'],
    // No vale volver a configurar `no-console`: con solo la severidad ESLint conserva las
    // opciones del bloque general (`allow: ['error']`), y `allow` no admite una lista vacia.
    // Ni basta con `console.*`: tambien se cierran `const c = console`, `const { error } =
    // console`, `globalThis.console`, `process.stdout/stderr` y los imports de `console`
    // (scripts/eslint-sin-console.test.mjs lo prueba con sondas). Quedan fuera
    // `const { stderr } = process` y `require`: el repo es ESM y no hay otra salida a mano.
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          "Identifier[name='console']",
          "MemberExpression[computed=true][property.value='console']",
          "MemberExpression[object.name='process'][property.name=/^std(out|err)$/]",
          "MemberExpression[object.name='process'][computed=true][property.value=/^std(out|err)$/]",
          'ImportDeclaration[source.value=/^(node:)?console$/]',
          'ImportExpression[source.value=/^(node:)?console$/]',
        ].map((selector) => ({
          selector,
          message:
            'Nada de console ni de stdout/stderr en la API: registra con `registrarEnConsola` (api/src/infra/registro.ts), que redacta cookies, autorizacion y contrasenas.',
        })),
      ],
    },
  },
  {
    // Identidad visual (frontend-patterns): los colores se nombran por
    // significado en `estilos.css`, nunca por hex crudo en un componente.
    // Si esto salta, el color que falta es un token nuevo en `@theme`, no
    // un `bg-[#...]` o un `style={{ color: '#...' }}` sueltos.
    files: ['web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3}|[0-9a-fA-F]{2})?\\b/]',
          message:
            'Nada de colores hex sueltos en componentes: usa un token de `estilos.css` (var(--color-*) o la clase Tailwind correspondiente).',
        },
        {
          selector:
            'TemplateElement[value.raw=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3}|[0-9a-fA-F]{2})?\\b/]',
          message:
            'Nada de colores hex sueltos en componentes: usa un token de `estilos.css` (var(--color-*) o la clase Tailwind correspondiente).',
        },
      ],
    },
  },
  prettier,
);
