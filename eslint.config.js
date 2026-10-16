import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Lo que la CSP de produccion (docker/Caddyfile: sin 'unsafe-inline' ni 'unsafe-eval') bloquearia
// en el navegador. En desarrollo no hay CSP, asi que solo fallaria en produccion: tiene que
// fallar aqui. NO se vigila lo que la CSP no bloquea: la prop `style` de React y `el.style.x = ...`
// van por CSSOM. Las sondas estan en scripts/eslint-csp-web.test.mjs. `setTimeout('...')` y
// compania ya los vigila `@typescript-eslint/no-implied-eval`, activo en `recommendedTypeChecked`.
const mensajeCsp = (que) =>
  `${que}: la CSP de produccion (docker/Caddyfile) no admite codigo ni estilos en linea, y en desarrollo no hay CSP. Usa una clase, la prop \`style\` de React o un fichero.`;
const SINTAXIS_QUE_ROMPE_LA_CSP = [
  [
    "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(style|on[a-z]+)$/i]",
    "setAttribute('style' | 'on...')",
  ],
  [
    "CallExpression[callee.property.name='setAttributeNS'][arguments.1.value=/^(style|on[a-z]+)$/i]",
    "setAttributeNS(..., 'style' | 'on...')",
  ],
  [
    "CallExpression[callee.property.name='createElement'][arguments.0.value=/^(style|script)$/i]",
    "createElement('style' | 'script')",
  ],
  [
    "CallExpression[callee.name='createElement'][arguments.0.value=/^(style|script)$/i]",
    "createElement('style' | 'script')",
  ],
  [
    "CallExpression[callee.property.name='createElementNS'][arguments.1.value=/^(style|script)$/i]",
    "createElementNS(..., 'style' | 'script')",
  ],
  [
    "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(innerHTML|outerHTML)$/]",
    'innerHTML / outerHTML',
  ],
  [
    "AssignmentExpression[left.type='MemberExpression'][left.property.value=/^(innerHTML|outerHTML)$/]",
    "['innerHTML'] / ['outerHTML']",
  ],
  ["CallExpression[callee.property.name='insertAdjacentHTML']", 'insertAdjacentHTML'],
  [
    "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
    'document.write',
  ],
  ["JSXAttribute[name.name='dangerouslySetInnerHTML']", 'dangerouslySetInnerHTML'],
  ["Property[key.name='dangerouslySetInnerHTML']", 'dangerouslySetInnerHTML'],
  ['JSXOpeningElement[name.name=/^(style|script)$/]', '<style> / <script> en JSX'],
].map(([selector, que]) => ({ selector, message: mensajeCsp(que) }));

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
    //
    // Y la CSP de produccion: nada de codigo ni estilos en linea (ver arriba).
    files: ['web/src/**/*.{ts,tsx}'],
    // Navegador: sin `window` como global conocida, `no-eval` no ve `window.eval(...)`.
    languageOptions: { globals: globals.browser },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-syntax': [
        'error',
        ...SINTAXIS_QUE_ROMPE_LA_CSP,
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
