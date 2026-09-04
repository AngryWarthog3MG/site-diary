import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The running build's identity, so an installed phone app can tell it is
  // behind. On Vercel this is the deployment id (set for CLI deploys as well
  // as git ones); locally a constant, so dev never reloads itself.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_DEPLOYMENT_ID ?? 'dev' },
  // The record is written on site; never cache an authenticated response.
  poweredByHeader: false,
  // Playwright ships browser binaries and native bindings — bundling it breaks
  // the launcher's path resolution.
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium'],
  // Being external means Next does not follow the imports, so it never learns
  // that playwright-core reads browsers.json at runtime and the file is left
  // out of the deployment. The failure is a module-not-found for a JSON file,
  // hundreds of lines from anything that mentions PDFs.
  // Keyed by route glob rather than exact paths: the dynamic segment in the
  // PDF route was not matching as written ('/api/entries/[id]/pdf'), so the
  // files were traced into the ops function but not the one that renders
  // real dockets — which is why the probe passed while the button failed.
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
    ],
  },
};

export default nextConfig;
