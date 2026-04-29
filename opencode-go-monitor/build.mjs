import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'warning',
  });

  if (production) {
    await ctx.rebuild();
    await ctx.dispose();
  } else {
    await ctx.watch();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
