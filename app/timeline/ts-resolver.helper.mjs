// Lets `node --test` load the TypeScript modules in this folder directly.
//
// Node strips types from `.ts` files on its own, but ESM still needs a file
// extension on every relative specifier, while the app sources use the
// extensionless style the bundler expects. This hook bridges the two so the
// focused tests import exactly the modules the app ships — no copies.

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (relative && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through to the default resolution below.
    }
  }
  return nextResolve(specifier, context);
}
