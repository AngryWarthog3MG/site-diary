import type { SupabaseClient } from '@supabase/supabase-js';
import { registerFor, registerSummary, type RegisterLine, type RegisterVerdict, type SdsFacts } from './model';

/**
 * The hazardous chemicals register for one workplace, read under the caller's
 * RLS. Every role on the job can read it, labourers included — reg. 346(3)
 * requires it be readily accessible to the workers involved, which is the
 * point of the table.
 */

export interface ProductRow {
  id: string;
  name: string;
  manufacturer: string | null;
  product_code: string | null;
  hazard_classes: string[] | null;
  dg_class: string | null;
  used_for: string | null;
  notes: string | null;
  active: boolean;
  chemical_sds: SdsFacts[];
}

export interface ChemicalsData {
  /** On this workplace, with the verdict on each sheet. */
  register: RegisterVerdict[];
  summary: ReturnType<typeof registerSummary>;
  /** Everything the company keeps, so one can be added to this job without retyping it. */
  products: ProductRow[];
  /** Product ids already on this job. */
  onJob: Set<string>;
}

export async function loadChemicals(
  supabase: SupabaseClient,
  projectId: string,
  orgId: string,
  today: string,
): Promise<ChemicalsData> {
  const [{ data: productRows }, { data: linkRows }] = await Promise.all([
    supabase
      .from('chemical_products')
      .select('id, name, manufacturer, product_code, hazard_classes, dg_class, used_for, notes, active, chemical_sds(id, issued_on, version, file_path, active)')
      .eq('org_id', orgId)
      .order('name'),
    supabase
      .from('project_chemicals')
      .select('product_id, location, quantity, active')
      .eq('project_id', projectId)
      .eq('active', true),
  ]);

  const products = (productRows ?? []) as ProductRow[];
  const byId = new Map(products.map((p) => [p.id, p]));
  const links = (linkRows ?? []) as Array<{ product_id: string; location: string | null; quantity: string | null }>;

  const lines: RegisterLine[] = [];
  for (const link of links) {
    const product = byId.get(link.product_id);
    if (!product) continue;
    lines.push({
      productId: product.id,
      name: product.name,
      manufacturer: product.manufacturer,
      hazardClasses: product.hazard_classes ?? [],
      dgClass: product.dg_class,
      location: link.location,
      quantity: link.quantity,
      sheets: product.chemical_sds ?? [],
    });
  }

  const register = registerFor(lines, today);
  return {
    register,
    summary: registerSummary(register),
    products,
    onJob: new Set(links.map((l) => l.product_id)),
  };
}
