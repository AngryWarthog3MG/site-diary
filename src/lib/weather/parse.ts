import { XMLParser } from 'fast-xml-parser';
import type { BomSnapshot, ObservationElement, StationObservation } from './types';

/**
 * Parses a BOM state observation product (ID{X}60920.xml).
 *
 * Every element keeps its window attributes rather than being flattened to a
 * number — see derive.ts, where deciding whether a reading actually covers the
 * work day is the entire job.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

type Node = Record<string, unknown>;

const asArray = (value: unknown): Node[] =>
  value == null ? [] : Array.isArray(value) ? (value as Node[]) : [value as Node];

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function parseObservations(xml: string, productId: string): BomSnapshot {
  const doc = parser.parse(xml) as Node;
  const product = doc.product as Node | undefined;
  if (!product) {
    throw new Error('Not a BOM product document.');
  }

  const amoc = product.amoc as Node | undefined;
  const issuedAt = str((amoc?.['issue-time-utc'] as string) ?? null);

  const observations = product.observations as Node | undefined;
  const stations = asArray(observations?.station).map(parseStation).filter(Boolean);

  return {
    productId,
    issuedAt,
    stations: stations as StationObservation[],
  };
}

function parseStation(node: Node): StationObservation | null {
  const lat = num(node['@lat']);
  const lon = num(node['@lon']);
  const name = str(node['@stn-name']);
  if (lat == null || lon == null || !name) return null;

  // Products carry a single latest period per station, but the schema allows
  // several; take the most recent by observation time.
  const periods = asArray(node.period).sort((a, b) =>
    String(b['@time-utc'] ?? '').localeCompare(String(a['@time-utc'] ?? '')),
  );
  const period = periods[0];

  const elements: ObservationElement[] = [];
  for (const level of asArray(period?.level)) {
    for (const element of asArray(level.element)) {
      const type = str(element['@type']);
      if (!type) continue;
      const text = str(element['#text']);
      elements.push({
        type,
        value: num(text),
        text,
        units: str(element['@units']),
        startLocal: str(element['@start-time-local']),
        endLocal: str(element['@end-time-local']),
      });
    }
  }

  return {
    wmoId: str(node['@wmo-id']),
    bomId: str(node['@bom-id']),
    name,
    lat,
    lon,
    timezone: str(node['@tz']),
    observedAt: str(period?.['@time-utc']),
    observedLocal: str(period?.['@time-local']),
    elements,
  };
}
