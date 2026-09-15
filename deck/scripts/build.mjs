import { build, context } from "esbuild";

/**
 * One bundle, into the plugin folder the Stream Deck app loads.
 *
 * esbuild rather than the rollup setup `streamdeck create` scaffolds: this is
 * one entry point with one external, and a bundler config file would be longer
 * than the thing it configures.
 *
 * BUNDLED, NOT LINKED. The Stream Deck app runs bin/plugin.js with its own Node,
 * from a directory it copies or symlinks — node_modules is not reliably beside
 * it, so everything has to be in the file.
 */
const options = {
  entryPoints: ["src/plugin.ts"],
  outfile: "com.dayboard.deck.sdPlugin/bin/plugin.js",
  bundle: true,
  format: "esm",
  platform: "node",
  // Matches Nodejs.Version in the manifest, which is the runtime the Stream Deck
  // app actually hands this to.
  target: "node20",
  sourcemap: true,
  // ESM output, so the CommonJS interop shims esbuild would otherwise inject for
  // `import`ed CJS deps need a banner to have somewhere to live.
  banner: {
    js: [
      "import { createRequire as __deckRequire } from 'node:module';",
      "const require = __deckRequire(import.meta.url);",
    ].join("\n"),
  },
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("watching src/ — streamdeck restart com.dayboard.deck to reload");
} else {
  await build(options);
  console.log(`built ${options.outfile}`);
}
