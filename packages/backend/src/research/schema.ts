import { z } from 'zod';
export const DOMAINS = ['politics','macro','btc','stocks','ai','ideas','unknown'] as const;
export const targetSchema = z.object({ question: z.string().trim().min(1).max(600), domain: z.enum(DOMAINS).default('unknown'), hypothesis: z.string().trim().max(1200).optional(), terms: z.array(z.string().trim().min(1).max(80)).max(15).default([]), publicTerms: z.array(z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} ._-]+$/u)).max(5).default([]), scope:z.object({region:z.string().max(80).optional(),assets:z.array(z.string().max(40)).max(10).optional(),horizon:z.string().max(80).optional(),invalidation:z.string().max(1200).optional()}).default({}) });
export const claimSchema = z.object({ text: z.string().max(2000), kind: z.enum(['fact','proposal','passed','effective','paused','forecast','unknown']).default('unknown'), value: z.number().nullable().default(null), unit: z.string().nullable().default(null), period: z.string().nullable().default(null), consensus: z.number().nullable().default(null), consensusSource: z.string().nullable().default(null) });
export const evidenceSchema = z.object({ title: z.string().min(1).max(600), url: z.string().url().max(2000).refine(value=>{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;},'invalid_source_url'), source: z.string().min(1).max(200), originKey: z.string().max(2000).optional(), body: z.string().min(1).max(100000), claims: z.array(claimSchema).max(50).default([]), domain: z.enum(DOMAINS).default('unknown'), publishedAt: z.string().datetime().nullable().default(null), occurredAt: z.string().datetime().nullable().default(null), timePrecision: z.enum(['second','minute','day','unknown']).default('unknown'), timeMetadata:z.object({sourceTimezone:z.string().max(100).optional(),publishedRaw:z.string().max(300).optional()}).default({}), mode: z.enum(['demo','source']).default('source') });
const finding = z.object({ text: z.string().min(1).max(2500), relation: z.enum(['supports','refutes','neutral','unknown']), citations: z.array(z.object({ evidenceId: z.string(), quote: z.string().min(1).max(2000) })).max(10), assumption: z.boolean().default(false) });
export const briefSchema = z.object({ findings: z.array(finding).max(30), changes: z.array(z.string().max(1500)).max(20), alternatives: z.array(finding).max(20), conflicts: z.array(z.string().max(1500)).max(20), unknowns: z.array(z.string().max(1500)).max(20), nextChecks: z.array(z.string().max(1500)).max(15) });
export type Brief = z.infer<typeof briefSchema>;
export interface Evidence { id: string; title: string; url: string; source: string; origin_key: string; body: string; claims: z.infer<typeof claimSchema>[]; domain: string; published_at: Date | null; occurred_at: Date | null; available_at: Date; time_precision: string; time_metadata?:z.infer<typeof evidenceSchema>['timeMetadata']; mode: string; previous_id: string | null; fetch_status: string }
export interface Target { id: string; version: number; question: string; domain: string; hypothesis: string | null; terms: string[]; public_terms: string[]; scope?:z.infer<typeof targetSchema>['scope']; status: string }
export function validateBrief(raw: unknown, evidence: Evidence[]): Brief {
 const output = briefSchema.parse(raw); const byId = new Map(evidence.map(e=>[e.id,e]));
 for(const f of [...output.findings,...output.alternatives]) {
  if(!f.assumption && !f.citations.length) throw new Error('uncited_assertion');
  for(const c of f.citations) { const e=byId.get(c.evidenceId); if(!e || !e.body.includes(c.quote)) throw new Error('invalid_citation'); }
 }
 for(const text of [...output.changes,...output.conflicts]) {
  const ids=[...text.matchAll(/\[([a-f0-9-]{36})\]/g)].map(m=>m[1]);
  if(!ids.length || ids.some(id=>!byId.has(id)))throw new Error("uncited_change_or_conflict");
 }
 return output;
}
