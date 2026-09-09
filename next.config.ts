import type { NextConfig } from 'next';

const CHROMIUM = [
  './node_modules/playwright-core/**',
  './node_modules/@sparticuz/chromium/**',
];

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
  // pdf.js likewise: bundled, its fake worker cannot find pdf.worker.mjs
  // beside itself. Left external, it loads from node_modules as shipped.
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium', 'pdfjs-dist'],
  // Being external means Next does not follow the imports, so it never learns
  // that playwright-core reads browsers.json at runtime and the file is left
  // out of the deployment. The failure is a module-not-found for a JSON file,
  // hundreds of lines from anything that mentions PDFs.
  // Keyed by route glob rather than exact paths: the dynamic segment in the
  // PDF route was not matching as written ('/api/entries/[id]/pdf'), so the
  // files were traced into the ops function but not the one that renders
  // real dockets — which is why the probe passed while the button failed.
  // Only the functions that render a document carry Chromium (~80 MB with
  // Playwright), and only the document routes carry the PDF reader. Tracing
  // both into every API function put ~115 MB behind each of 36 routes on
  // every deployment, which is how a free team's 10 GB of Function Storage
  // filled up in a fortnight. A route missing from this list fails loudly
  // ("Chromium not found") — never silently — so add it here, not '/api/**'.
  outputFileTracingIncludes: {
    // Daily docket, client sheet, emailed PDF.
    '/api/entries/*/pdf': CHROMIUM,
    '/api/entries/*/client-sheet': CHROMIUM,
    '/api/entries/*/email': CHROMIUM,
    // Prestart and toolbox-talk PDFs.
    '/api/prestart/*/pdf': CHROMIUM,
    '/api/toolbox/*/pdf': CHROMIUM,
    // Weekly (both), monthly bundle, and the cron that generates them.
    '/api/reports/**': CHROMIUM,
    '/api/ops/check': CHROMIUM,
    // Job documents: typed PDFs are read with pdf.js.
    '/api/documents/**': ['./node_modules/pdfjs-dist/legacy/build/**'],
  },
};

export default nextConfig;
