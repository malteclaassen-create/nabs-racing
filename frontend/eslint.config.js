import globals from "globals";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";

// ---------------------------------------------------------------------------
// One job: catch a name that is used and never defined.
//
// This exists because of a real outage. A prop was threaded through a deep JSX
// tree, and two of the places that read it sat in a *different* component from
// the one that received it. `vite build` compiles that happily, the tests never
// touch it, and the Live page threw `serverKey is not defined` the moment a
// track map rendered, so the whole route fell to the error boundary.
//
// So this config is deliberately narrow: no style rules, no opinions, nothing
// that would make it noisy enough to start ignoring. Only the class of mistake
// a bundler cannot see and a browser finds for you in production.
// ---------------------------------------------------------------------------

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // The `exhaustive-deps` rule is off on purpose, so the disable comments
    // written for it are dormant rather than stale. Don't nag about them.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { react, "react-hooks": hooks },
    settings: { react: { version: "18.3" } },
    rules: {
      "no-undef": "error",
      // JSX counts as a use: without this every imported component reads as
      // unused and the rule below drowns the real finding.
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      // Registered so the existing `eslint-disable-next-line
      // react-hooks/exhaustive-deps` comments resolve to a real rule. The
      // dependency rule itself stays off (the codebase leaves deps out on
      // purpose in places); calling hooks conditionally is a genuine crash and
      // stays on.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
