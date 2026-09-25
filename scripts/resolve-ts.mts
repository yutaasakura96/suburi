import { registerHooks } from "node:module";

// `node --import ./scripts/resolve-ts.mts`. The app's modules import each other without extensions,
// which Next resolves and Node's type stripping does not. A relative specifier that fails to resolve
// is retried with `.ts`, so a hand-run script can load app code (lib/auth) without the app changing.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || (error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
