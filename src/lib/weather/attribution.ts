/**
 * Required wherever these numbers are shown or exported. The product itself
 * points at http://www.bom.gov.au/other/copyright.shtml.
 *
 * This lives in its own leaf module, with no imports, because the daily docket
 * needs it and the docket is compiled standalone for the determinism check
 * (tsconfig.pdf.json). Importing it from `bom.ts` would drag the FTP client
 * into that build. `bom.ts` re-exports it, so existing importers are unchanged.
 */
export const BOM_ATTRIBUTION = 'Observations © Commonwealth of Australia, Bureau of Meteorology';
