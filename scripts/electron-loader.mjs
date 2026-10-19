// Maps the bare `electron` import onto the stand-in the tests use, so the main
// process modules can run under plain Node. Loaded by `electron-register.mjs`,
// and only useful together with `--import tsx`, since the stand-in is TypeScript.
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return {
      url: new URL('../packages/main/test/electron-stub.ts', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
