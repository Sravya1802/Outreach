// Industry categories (labels match jobs.category values written by the backend classifier).
export const CATEGORIES: { label: string; desc: string; query: string }[] = [
  { label: 'Tech & Software', desc: 'Big Tech, enterprise software, cloud, SaaS', query: 'software engineer intern' },
  { label: 'AI & Research', desc: 'AI labs, AI infra, applied AI, robotics', query: 'AI machine learning intern' },
  { label: 'Finance & Investing', desc: 'Quant funds, banks, fintech, crypto', query: 'fintech quant trading intern' },
  { label: 'Startups', desc: 'YC and seed–Series B startups', query: 'startup software engineer intern' },
  { label: 'Data & Analytics', desc: 'Data infra, BI, market data', query: 'data engineering analytics intern' },
  { label: 'Hardware & Semiconductors', desc: 'Chips, devices, networking', query: 'hardware semiconductor engineering intern' },
  { label: 'Healthcare & Life Sciences', desc: 'Biotech, pharma, health tech', query: 'health tech biotech software intern' },
  { label: 'Automotive & Mobility', desc: 'EV, autonomy, aerospace', query: 'automotive EV autonomy software intern' },
  { label: 'Energy & Climate', desc: 'Renewables, storage, climate tech', query: 'climate tech energy software intern' },
  { label: 'Consumer & Retail', desc: 'E-commerce, marketplaces, CPG', query: 'e-commerce software engineer intern' },
  { label: 'Media & Entertainment', desc: 'Gaming, streaming, social, ad tech', query: 'gaming streaming software intern' },
  { label: 'Defense & Government', desc: 'Defense tech, GovTech', query: 'defense technology software intern' },
  { label: 'Logistics & Supply Chain', desc: 'Shipping, delivery, supply chain tech', query: 'logistics supply chain software intern' },
  { label: 'Education', desc: 'EdTech, research institutions', query: 'edtech software engineer intern' },
  { label: 'Travel & Hospitality', desc: 'Travel tech, hotels, airlines', query: 'travel tech software intern' },
  { label: 'Manufacturing & Industrials', desc: 'Industrial automation, robotics', query: 'industrial automation software intern' },
  { label: 'HR & Workforce', desc: 'HR tech, payroll, staffing', query: 'HR tech software engineer intern' },
  { label: 'Marketing & Creative', desc: 'Martech, creator platforms', query: 'marketing technology software intern' },
  { label: 'Legal & Compliance', desc: 'LegalTech, compliance tech', query: 'legal tech software intern' },
  { label: 'Food & Beverage', desc: 'Food tech, delivery, alt protein', query: 'food tech software intern' },
  { label: 'Sports & Fitness', desc: 'Sports tech, fitness, esports', query: 'sports tech software intern' },
  { label: 'Emerging & Niche', desc: 'SpaceTech, AgriTech, PropTech', query: 'space agritech proptech software intern' },
]

/**
 * The internship season people are recruiting for: from August onward that's
 * next summer (in Oct 2026 students apply for Summer 2027).
 */
export function recruitingSeasonYear(now: Date = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()
}

export function defaultScrapeQuery(category: string, now: Date = new Date()): string {
  const base = CATEGORIES.find(c => c.label === category)?.query ?? `${category} intern`
  return `${base} ${recruitingSeasonYear(now)}`
}
