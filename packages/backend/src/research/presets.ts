import { sql } from "../db.ts";

/** Editable examples, not comprehensive coverage or the user's final source choices. */
export const RESEARCH_SOURCES = [
  { id: "research-fed", name: "Federal Reserve · press releases", domain: "macro", feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml", reference: "https://www.federalreserve.gov/feeds/feeds.htm" },
  { id: "research-bls-cpi", name: "BLS · CPI releases", domain: "macro", feedUrl: "https://www.bls.gov/feed/cpi.rss", reference: "https://www.bls.gov/feed/" },
  { id: "research-ecb", name: "ECB · policy communication", domain: "macro", feedUrl: "https://www.ecb.europa.eu/rss/press.html", reference: "https://www.ecb.europa.eu/home/html/rss.en.html" },
  { id: "research-sec", name: "SEC · press releases", domain: "politics", feedUrl: "https://www.sec.gov/news/pressreleases.rss", reference: "https://www.sec.gov/about/rss-feeds" },
  { id: "research-bitcoin-core", name: "Bitcoin Core · code releases", domain: "btc", feedUrl: "https://github.com/bitcoin/bitcoin/releases.atom", reference: "https://github.com/bitcoin/bitcoin/releases" },
] as const;

/** Isolated sources remain outside public editorial publication. Global collection valves still apply. */
export async function importResearchSources() {
  for (const source of RESEARCH_SOURCES) {
    const config = { feedUrl: source.feedUrl, researchDomain: source.domain, fetchPublicContent: false, _aihot: { initialBackfillLimit: 5 } };
    await sql`INSERT INTO sources(id,name,kind,config,tier,first_party,participation_mode,interval_minutes,site_fulltext,syndicate_fulltext)
      VALUES(${source.id},${source.name},'rss',${sql.json(config)},'T1',true,'isolated',120,false,false)
      ON CONFLICT(id) DO NOTHING`;
  }
  return { examples: RESEARCH_SOURCES.length };
}
