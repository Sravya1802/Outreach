import { complete } from './llm.js';

// Lazy accessors — avoid dotenv timing issues

// ─── Level 2: Known-companies map ────────────────────────────────────────────
// Exact company name → category (lowercased keys). Covers ~300 well-known employers.

export const KNOWN_COMPANIES = new Map([
  // ── Investment Banks ──────────────────────────────────────────────────────
  ['goldman sachs',           { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['morgan stanley',          { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['jp morgan',               { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['jpmorgan',                { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['jpmorgan chase',          { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['j.p. morgan',             { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['bank of america',         { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['citigroup',               { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['citibank',                { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['citi',                    { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['barclays',                { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['ubs',                     { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['deutsche bank',           { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['credit suisse',           { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['wells fargo',             { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['hsbc',                    { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['lazard',                  { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['jefferies',               { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['evercore',                { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['moelis',                  { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['pjt partners',            { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['raymond james',           { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['stifel',                  { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['nomura',                  { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['mizuho',                  { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['bmo',                     { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['rbc',                     { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.95 }],
  ['td securities',           { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['macquarie',               { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.90 }],
  ['cowen',                   { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['william blair',           { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['baird',                   { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],
  ['cantor fitzgerald',       { category: 'Finance & Investing', subcategory: 'Investment Banks',           confidence: 0.99 }],

  // ── Quant Funds & Prop Trading ────────────────────────────────────────────
  ['two sigma',               { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['citadel',                 { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['citadel securities',      { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['jane street',             { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['de shaw',                 { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['d.e. shaw',               { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['renaissance technologies',{ category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['jump trading',            { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['virtu financial',         { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['hudson river trading',    { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['hrt',                     { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.90 }],
  ['optiver',                 { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['flow traders',            { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['susquehanna',             { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['sig',                     { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.90 }],
  ['imc',                     { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.90 }],
  ['akuna capital',           { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['old mission capital',     { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['chicago trading company', { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['tower research capital',  { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['dv trading',              { category: 'Finance & Investing', subcategory: 'Prop Trading Firms',        confidence: 0.99 }],
  ['g-research',              { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['five rings',              { category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.99 }],
  ['tradestation',            { category: 'Finance & Investing', subcategory: 'Retail Brokerages',         confidence: 0.90 }],

  // ── Hedge Funds ───────────────────────────────────────────────────────────
  ['bridgewater',             { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['millennium management',   { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['millennium',              { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.90 }],
  ['point72',                 { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['aqr capital',             { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['balyasny',                { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['man group',               { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['winton',                  { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['tudor',                   { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.90 }],
  ['schonfeld',               { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['capstone',                { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.80 }],
  ['exoduspoint',             { category: 'Finance & Investing', subcategory: 'Hedge Funds',               confidence: 0.99 }],
  ['marathon asset management',{ category: 'Finance & Investing', subcategory: 'Hedge Funds',              confidence: 0.99 }],

  // ── Asset Management ──────────────────────────────────────────────────────
  ['blackrock',               { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['vanguard',                { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['fidelity',                { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['pimco',                   { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['t. rowe price',           { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['invesco',                 { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['state street',            { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.95 }],
  ['franklin templeton',      { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['nuveen',                  { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['wellington management',   { category: 'Finance & Investing', subcategory: 'Asset Management',          confidence: 0.99 }],
  ['dimensional fund advisors',{ category: 'Finance & Investing', subcategory: 'Asset Management',         confidence: 0.99 }],

  // ── Payments & Fintech ────────────────────────────────────────────────────
  ['stripe',                  { category: 'Finance & Investing', subcategory: 'Payments & Payment Processors', confidence: 0.99 }],
  ['square',                  { category: 'Finance & Investing', subcategory: 'Payments & Payment Processors', confidence: 0.95 }],
  ['block',                   { category: 'Finance & Investing', subcategory: 'Payments & Payment Processors', confidence: 0.90 }],
  ['paypal',                  { category: 'Finance & Investing', subcategory: 'Payments & Payment Processors', confidence: 0.99 }],
  ['plaid',                   { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['chime',                   { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['affirm',                  { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['brex',                    { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['ramp',                    { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['marqeta',                 { category: 'Finance & Investing', subcategory: 'Payments & Payment Processors', confidence: 0.99 }],
  ['klarna',                  { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['adyen',                   { category: 'Finance & Investing', subcategory: 'Payments & Payment Processors', confidence: 0.99 }],
  ['sofi',                    { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['nubank',                  { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['wise',                    { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.90 }],
  ['revolut',                 { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.99 }],
  ['mercury',                 { category: 'Finance & Investing', subcategory: 'Fintech',                   confidence: 0.90 }],

  // ── Crypto / Blockchain ───────────────────────────────────────────────────
  ['coinbase',                { category: 'Finance & Investing', subcategory: 'Crypto Exchanges',          confidence: 0.99 }],
  ['binance',                 { category: 'Finance & Investing', subcategory: 'Crypto Exchanges',          confidence: 0.99 }],
  ['kraken',                  { category: 'Finance & Investing', subcategory: 'Crypto Exchanges',          confidence: 0.99 }],
  ['gemini',                  { category: 'Finance & Investing', subcategory: 'Crypto Exchanges',          confidence: 0.95 }],
  ['ripple',                  { category: 'Finance & Investing', subcategory: 'Blockchain Infrastructure', confidence: 0.99 }],
  ['chainalysis',             { category: 'Finance & Investing', subcategory: 'Blockchain Infrastructure', confidence: 0.99 }],

  // ── Retail Brokerage ──────────────────────────────────────────────────────
  ['robinhood',               { category: 'Finance & Investing', subcategory: 'Retail Brokerages',         confidence: 0.99 }],
  ['charles schwab',          { category: 'Finance & Investing', subcategory: 'Retail Brokerages',         confidence: 0.99 }],
  ['schwab',                  { category: 'Finance & Investing', subcategory: 'Retail Brokerages',         confidence: 0.99 }],
  ['interactive brokers',     { category: 'Finance & Investing', subcategory: 'Retail Brokerages',         confidence: 0.99 }],
  ['td ameritrade',           { category: 'Finance & Investing', subcategory: 'Retail Brokerages',         confidence: 0.99 }],
  ['etrade',                  { category: 'Finance & Investing', subcategory: 'Retail Brokerages',         confidence: 0.99 }],

  // ── Private Equity / VC ───────────────────────────────────────────────────
  ['blackstone',              { category: 'Finance & Investing', subcategory: 'Private Equity',            confidence: 0.99 }],
  ['kkr',                     { category: 'Finance & Investing', subcategory: 'Private Equity',            confidence: 0.99 }],
  ['carlyle group',           { category: 'Finance & Investing', subcategory: 'Private Equity',            confidence: 0.99 }],
  ['apollo global',           { category: 'Finance & Investing', subcategory: 'Private Equity',            confidence: 0.99 }],
  ['tpg',                     { category: 'Finance & Investing', subcategory: 'Private Equity',            confidence: 0.90 }],
  ['warburg pincus',          { category: 'Finance & Investing', subcategory: 'Private Equity',            confidence: 0.99 }],
  ['andreessen horowitz',     { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.99 }],
  ['a16z',                    { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.99 }],
  ['sequoia',                 { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.99 }],
  ['kleiner perkins',         { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.99 }],
  ['greylock',                { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.99 }],
  ['khosla ventures',         { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.99 }],
  ['index ventures',          { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.99 }],
  ['accel',                   { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.90 }],
  ['general catalyst',        { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.99 }],
  ['lightspeed',              { category: 'Finance & Investing', subcategory: 'Venture Capital',           confidence: 0.85 }],

  // ── Big Tech / FAANG ──────────────────────────────────────────────────────
  ['google',                  { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['alphabet',                { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['meta',                    { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['facebook',                { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['amazon',                  { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['apple',                   { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['microsoft',               { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['netflix',                 { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['twitter',                 { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.99 }],
  ['x corp',                  { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.95 }],
  ['uber',                    { category: 'Tech & Software', subcategory: 'Big Tech / FAANG',              confidence: 0.95 }],
  ['tiktok',                  { category: 'Media & Entertainment', subcategory: 'Social Media',            confidence: 0.99 }],
  ['bytedance',               { category: 'Media & Entertainment', subcategory: 'Social Media',            confidence: 0.99 }],
  ['pinterest',               { category: 'Media & Entertainment', subcategory: 'Social Media',            confidence: 0.99 }],
  ['snap',                    { category: 'Media & Entertainment', subcategory: 'Social Media',            confidence: 0.99 }],
  ['snapchat',                { category: 'Media & Entertainment', subcategory: 'Social Media',            confidence: 0.99 }],
  ['reddit',                  { category: 'Media & Entertainment', subcategory: 'Social Media',            confidence: 0.99 }],
  ['discord',                 { category: 'Media & Entertainment', subcategory: 'Social Media',            confidence: 0.99 }],

  // ── Enterprise Software & SaaS ────────────────────────────────────────────
  ['salesforce',              { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['servicenow',              { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['oracle',                  { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['sap',                     { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['workday',                 { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['adobe',                   { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['ibm',                     { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['intuit',                  { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['zendesk',                 { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.95 }],
  ['hubspot',                 { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['freshworks',              { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.95 }],
  ['zoom',                    { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['slack',                   { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['docusign',                { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['dropbox',                 { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.99 }],
  ['box',                     { category: 'Tech & Software', subcategory: 'Enterprise Software',           confidence: 0.95 }],
  ['veeva systems',           { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],
  ['twilio',                  { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],
  ['sendgrid',                { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.90 }],
  ['intercom',                { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],
  ['klaviyo',                 { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],
  ['asana',                   { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],
  ['notion',                  { category: 'Startups', subcategory: 'B2B SaaS Startups',                   confidence: 0.99 }],
  ['figma',                   { category: 'Startups', subcategory: 'B2B SaaS Startups',                   confidence: 0.99 }],
  ['canva',                   { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],
  ['linear',                  { category: 'Startups', subcategory: 'Dev Tools Startups',                   confidence: 0.99 }],
  ['airtable',                { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],
  ['monday.com',              { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],
  ['clickup',                 { category: 'Tech & Software', subcategory: 'SaaS',                          confidence: 0.99 }],

  // ── Cloud Providers ───────────────────────────────────────────────────────
  ['cloudflare',              { category: 'Tech & Software', subcategory: 'Cloud Providers',               confidence: 0.99 }],
  ['fastly',                  { category: 'Tech & Software', subcategory: 'Cloud Providers',               confidence: 0.99 }],
  ['digitalocean',            { category: 'Tech & Software', subcategory: 'Cloud Providers',               confidence: 0.99 }],

  // ── Developer Tools ───────────────────────────────────────────────────────
  ['github',                  { category: 'Tech & Software', subcategory: 'Developer Tools',               confidence: 0.99 }],
  ['gitlab',                  { category: 'Tech & Software', subcategory: 'Developer Tools',               confidence: 0.99 }],
  ['vercel',                  { category: 'Startups', subcategory: 'Dev Tools Startups',                   confidence: 0.99 }],
  ['netlify',                 { category: 'Tech & Software', subcategory: 'Developer Tools',               confidence: 0.99 }],
  ['hashicorp',               { category: 'Tech & Software', subcategory: 'Developer Tools',               confidence: 0.99 }],
  ['datadog',                 { category: 'Tech & Software', subcategory: 'Developer Tools',               confidence: 0.99 }],
  ['new relic',               { category: 'Tech & Software', subcategory: 'Developer Tools',               confidence: 0.99 }],
  ['pagerduty',               { category: 'Tech & Software', subcategory: 'Developer Tools',               confidence: 0.99 }],
  ['atlassian',               { category: 'Tech & Software', subcategory: 'Developer Tools',               confidence: 0.99 }],
  ['retool',                  { category: 'Startups', subcategory: 'Dev Tools Startups',                   confidence: 0.99 }],

  // ── Cybersecurity ─────────────────────────────────────────────────────────
  ['crowdstrike',             { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['palo alto networks',      { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['zscaler',                 { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['okta',                    { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['fortinet',                { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['splunk',                  { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['sentinelone',             { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['rapid7',                  { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['qualys',                  { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['cyberark',                { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['lacework',                { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['tenable',                 { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],
  ['darktrace',               { category: 'Tech & Software', subcategory: 'Cybersecurity',                 confidence: 0.99 }],

  // ── AI Labs ───────────────────────────────────────────────────────────────
  ['openai',                  { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['anthropic',               { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['cohere',                  { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['mistral',                 { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['stability ai',            { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['hugging face',            { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['character.ai',            { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['inflection ai',           { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['adept',                   { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.90 }],
  ['xai',                     { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.95 }],
  ['deepmind',                { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],
  ['allen institute for ai',  { category: 'AI & Research', subcategory: 'AI Labs',                         confidence: 0.99 }],

  // ── Applied AI ────────────────────────────────────────────────────────────
  ['scale ai',                { category: 'AI & Research', subcategory: 'Applied AI',                      confidence: 0.99 }],
  ['palantir',                { category: 'AI & Research', subcategory: 'Applied AI',                      confidence: 0.95 }],
  ['c3.ai',                   { category: 'AI & Research', subcategory: 'Applied AI',                      confidence: 0.99 }],

  // ── AI Infrastructure ─────────────────────────────────────────────────────
  ['databricks',              { category: 'AI & Research', subcategory: 'AI Infrastructure',               confidence: 0.99 }],
  ['weights & biases',        { category: 'AI & Research', subcategory: 'AI Infrastructure',               confidence: 0.99 }],
  ['weights and biases',      { category: 'AI & Research', subcategory: 'AI Infrastructure',               confidence: 0.99 }],

  // ── AI Chip Makers ────────────────────────────────────────────────────────
  ['nvidia',                  { category: 'AI & Research', subcategory: 'AI Chip Makers',                  confidence: 0.99 }],
  ['groq',                    { category: 'AI & Research', subcategory: 'AI Chip Makers',                  confidence: 0.99 }],
  ['cerebras',                { category: 'AI & Research', subcategory: 'AI Chip Makers',                  confidence: 0.99 }],
  ['tenstorrent',             { category: 'AI & Research', subcategory: 'AI Chip Makers',                  confidence: 0.99 }],
  ['sambanova',               { category: 'AI & Research', subcategory: 'AI Chip Makers',                  confidence: 0.99 }],

  // ── Semiconductor Manufacturers ───────────────────────────────────────────
  ['intel',                   { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['amd',                     { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['qualcomm',                { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['arm',                     { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['broadcom',                { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['texas instruments',       { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['marvell technology',      { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['microchip technology',    { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['analog devices',          { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['stmicroelectronics',      { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['cadence design systems',  { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['cadence',                 { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.95 }],
  ['synopsys',                { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['mediatek',                { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['lattice semiconductor',   { category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.99 }],
  ['western digital',         { category: 'Hardware & Semiconductors', subcategory: 'Storage & Memory',            confidence: 0.99 }],
  ['seagate',                 { category: 'Hardware & Semiconductors', subcategory: 'Storage & Memory',            confidence: 0.99 }],
  ['micron',                  { category: 'Hardware & Semiconductors', subcategory: 'Storage & Memory',            confidence: 0.99 }],
  ['micron technology',       { category: 'Hardware & Semiconductors', subcategory: 'Storage & Memory',            confidence: 0.99 }],
  ['cisco',                   { category: 'Hardware & Semiconductors', subcategory: 'Networking Hardware',         confidence: 0.99 }],
  ['juniper networks',        { category: 'Hardware & Semiconductors', subcategory: 'Networking Hardware',         confidence: 0.99 }],
  ['arista networks',         { category: 'Hardware & Semiconductors', subcategory: 'Networking Hardware',         confidence: 0.99 }],

  // ── Data & Analytics ──────────────────────────────────────────────────────
  ['snowflake',               { category: 'Data & Analytics', subcategory: 'Data Infrastructure',          confidence: 0.99 }],
  ['fivetran',                { category: 'Data & Analytics', subcategory: 'Data Infrastructure',          confidence: 0.99 }],
  ['airbyte',                 { category: 'Data & Analytics', subcategory: 'Data Infrastructure',          confidence: 0.99 }],
  ['dbt labs',                { category: 'Data & Analytics', subcategory: 'Data Infrastructure',          confidence: 0.99 }],
  ['tableau',                 { category: 'Data & Analytics', subcategory: 'Business Intelligence Platforms', confidence: 0.99 }],
  ['segment',                 { category: 'Data & Analytics', subcategory: 'Data Infrastructure',          confidence: 0.99 }],
  ['amplitude',               { category: 'Data & Analytics', subcategory: 'Business Intelligence Platforms', confidence: 0.99 }],
  ['mixpanel',                { category: 'Data & Analytics', subcategory: 'Business Intelligence Platforms', confidence: 0.99 }],
  ['bloomberg',               { category: 'Data & Analytics', subcategory: 'Market Data Providers',       confidence: 0.99 }],
  ['refinitiv',               { category: 'Data & Analytics', subcategory: 'Market Data Providers',       confidence: 0.99 }],
  ['factset',                 { category: 'Data & Analytics', subcategory: 'Market Data Providers',       confidence: 0.99 }],
  ['morningstar',             { category: 'Data & Analytics', subcategory: 'Market Data Providers',       confidence: 0.99 }],
  ['s&p global',              { category: 'Data & Analytics', subcategory: 'Market Data Providers',       confidence: 0.99 }],
  ['msci',                    { category: 'Data & Analytics', subcategory: 'Market Data Providers',       confidence: 0.99 }],
  ['verisk',                  { category: 'Data & Analytics', subcategory: 'Data Brokers',                confidence: 0.99 }],
  ['experian',                { category: 'Data & Analytics', subcategory: 'Data Brokers',                confidence: 0.99 }],
  ['equifax',                 { category: 'Data & Analytics', subcategory: 'Data Brokers',                confidence: 0.99 }],
  ['transunion',              { category: 'Data & Analytics', subcategory: 'Data Brokers',                confidence: 0.99 }],

  // ── Automotive & Mobility ─────────────────────────────────────────────────
  ['tesla',                   { category: 'Automotive & Mobility', subcategory: 'Electric Vehicles',       confidence: 0.99 }],
  ['rivian',                  { category: 'Automotive & Mobility', subcategory: 'Electric Vehicles',       confidence: 0.99 }],
  ['lucid motors',            { category: 'Automotive & Mobility', subcategory: 'Electric Vehicles',       confidence: 0.99 }],
  ['waymo',                   { category: 'Automotive & Mobility', subcategory: 'Autonomous Vehicles',     confidence: 0.99 }],
  ['cruise',                  { category: 'Automotive & Mobility', subcategory: 'Autonomous Vehicles',     confidence: 0.90 }],
  ['zoox',                    { category: 'Automotive & Mobility', subcategory: 'Autonomous Vehicles',     confidence: 0.99 }],
  ['aurora innovation',       { category: 'Automotive & Mobility', subcategory: 'Autonomous Vehicles',     confidence: 0.99 }],
  ['mobileye',                { category: 'Automotive & Mobility', subcategory: 'Autonomous Vehicles',     confidence: 0.99 }],
  ['ford',                    { category: 'Automotive & Mobility', subcategory: 'Legacy Auto',             confidence: 0.99 }],
  ['general motors',          { category: 'Automotive & Mobility', subcategory: 'Legacy Auto',             confidence: 0.99 }],
  ['toyota',                  { category: 'Automotive & Mobility', subcategory: 'Legacy Auto',             confidence: 0.99 }],
  ['volkswagen',              { category: 'Automotive & Mobility', subcategory: 'Legacy Auto',             confidence: 0.99 }],
  ['bmw',                     { category: 'Automotive & Mobility', subcategory: 'Legacy Auto',             confidence: 0.99 }],
  ['stellantis',              { category: 'Automotive & Mobility', subcategory: 'Legacy Auto',             confidence: 0.99 }],
  ['lyft',                    { category: 'Automotive & Mobility', subcategory: 'Ride-sharing',            confidence: 0.99 }],
  ['airbnb',                  { category: 'Travel & Hospitality', subcategory: 'Short-term Rentals',       confidence: 0.99 }],
  ['spacex',                  { category: 'Automotive & Mobility', subcategory: 'Aerospace & Space',       confidence: 0.99 }],
  ['blue origin',             { category: 'Automotive & Mobility', subcategory: 'Aerospace & Space',       confidence: 0.99 }],
  ['boeing',                  { category: 'Automotive & Mobility', subcategory: 'Aerospace & Space',       confidence: 0.95 }],
  ['rocket lab',              { category: 'Automotive & Mobility', subcategory: 'Aerospace & Space',       confidence: 0.99 }],
  ['relativity space',        { category: 'Automotive & Mobility', subcategory: 'Aerospace & Space',       confidence: 0.99 }],
  ['planet labs',             { category: 'Automotive & Mobility', subcategory: 'Aerospace & Space',       confidence: 0.99 }],

  // ── Healthcare & Life Sciences ────────────────────────────────────────────
  ['johnson & johnson',       { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['pfizer',                  { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['merck',                   { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['abbvie',                  { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['eli lilly',               { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['bristol myers squibb',    { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['roche',                   { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['novartis',                { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['astrazeneca',             { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['sanofi',                  { category: 'Healthcare & Life Sciences', subcategory: 'Pharma',             confidence: 0.99 }],
  ['genentech',               { category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.99 }],
  ['amgen',                   { category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.99 }],
  ['moderna',                 { category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.99 }],
  ['biogen',                  { category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.99 }],
  ['illumina',                { category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.99 }],
  ['10x genomics',            { category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.99 }],
  ['regeneron',               { category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.99 }],
  ['vertex pharmaceuticals',  { category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.99 }],
  ['intuitive surgical',      { category: 'Healthcare & Life Sciences', subcategory: 'Medical Devices',    confidence: 0.99 }],
  ['medtronic',               { category: 'Healthcare & Life Sciences', subcategory: 'Medical Devices',    confidence: 0.99 }],
  ['becton dickinson',        { category: 'Healthcare & Life Sciences', subcategory: 'Medical Devices',    confidence: 0.99 }],
  ['stryker',                 { category: 'Healthcare & Life Sciences', subcategory: 'Medical Devices',    confidence: 0.99 }],
  ['boston scientific',       { category: 'Healthcare & Life Sciences', subcategory: 'Medical Devices',    confidence: 0.99 }],
  ['edwards lifesciences',    { category: 'Healthcare & Life Sciences', subcategory: 'Medical Devices',    confidence: 0.99 }],
  ['epic systems',            { category: 'Healthcare & Life Sciences', subcategory: 'Health Tech',        confidence: 0.99 }],
  ['flatiron health',         { category: 'Healthcare & Life Sciences', subcategory: 'Health Tech',        confidence: 0.99 }],
  ['veeva',                   { category: 'Healthcare & Life Sciences', subcategory: 'Health Tech',        confidence: 0.90 }],
  ['tempus',                  { category: 'Healthcare & Life Sciences', subcategory: 'Health Tech',        confidence: 0.99 }],

  // ── Defense & Government ──────────────────────────────────────────────────
  ['lockheed martin',         { category: 'Defense & Government', subcategory: 'Defense Contractors',     confidence: 0.99 }],
  ['raytheon',                { category: 'Defense & Government', subcategory: 'Defense Contractors',     confidence: 0.99 }],
  ['northrop grumman',        { category: 'Defense & Government', subcategory: 'Defense Contractors',     confidence: 0.99 }],
  ['general dynamics',        { category: 'Defense & Government', subcategory: 'Defense Contractors',     confidence: 0.99 }],
  ['l3harris',                { category: 'Defense & Government', subcategory: 'Defense Contractors',     confidence: 0.99 }],
  ['bae systems',             { category: 'Defense & Government', subcategory: 'Defense Contractors',     confidence: 0.99 }],
  ['anduril',                 { category: 'Defense & Government', subcategory: 'GovTech / Defense Tech',  confidence: 0.99 }],
  ['shield ai',               { category: 'Defense & Government', subcategory: 'GovTech / Defense Tech',  confidence: 0.99 }],
  ['booz allen hamilton',     { category: 'Defense & Government', subcategory: 'GovTech / Defense Tech',  confidence: 0.99 }],
  ['saic',                    { category: 'Defense & Government', subcategory: 'GovTech / Defense Tech',  confidence: 0.99 }],
  ['leidos',                  { category: 'Defense & Government', subcategory: 'GovTech / Defense Tech',  confidence: 0.99 }],
  ['mitre',                   { category: 'Defense & Government', subcategory: 'GovTech / Defense Tech',  confidence: 0.99 }],
  ['saic',                    { category: 'Defense & Government', subcategory: 'GovTech / Defense Tech',  confidence: 0.99 }],

  // ── Gaming ────────────────────────────────────────────────────────────────
  ['activision blizzard',     { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['electronic arts',         { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['epic games',              { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['riot games',              { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['roblox',                  { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['unity technologies',      { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['take-two interactive',    { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['2k games',                { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['ubisoft',                 { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['bungie',                  { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['valve',                   { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['square enix',             { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['naughty dog',             { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],
  ['insomniac games',         { category: 'Media & Entertainment', subcategory: 'Gaming',                 confidence: 0.99 }],

  // ── Streaming / Media ─────────────────────────────────────────────────────
  ['spotify',                 { category: 'Media & Entertainment', subcategory: 'Streaming',              confidence: 0.99 }],
  ['hulu',                    { category: 'Media & Entertainment', subcategory: 'Streaming',              confidence: 0.99 }],
  ['disney',                  { category: 'Media & Entertainment', subcategory: 'Streaming',              confidence: 0.99 }],
  ['youtube',                 { category: 'Media & Entertainment', subcategory: 'Streaming',              confidence: 0.99 }],
  ['twitch',                  { category: 'Media & Entertainment', subcategory: 'Streaming',              confidence: 0.99 }],
  ['the trade desk',          { category: 'Media & Entertainment', subcategory: 'Ad Tech',                confidence: 0.99 }],
  ['magnite',                 { category: 'Media & Entertainment', subcategory: 'Ad Tech',                confidence: 0.99 }],
  ['pubmatic',                { category: 'Media & Entertainment', subcategory: 'Ad Tech',                confidence: 0.99 }],
  ['criteo',                  { category: 'Media & Entertainment', subcategory: 'Ad Tech',                confidence: 0.99 }],
  ['iab',                     { category: 'Media & Entertainment', subcategory: 'Ad Tech',                confidence: 0.80 }],
  ['new york times',          { category: 'Media & Entertainment', subcategory: 'News Media',             confidence: 0.99 }],
  ['washington post',         { category: 'Media & Entertainment', subcategory: 'News Media',             confidence: 0.99 }],
  ['axel springer',           { category: 'Media & Entertainment', subcategory: 'News Media',             confidence: 0.99 }],

  // ── E-Commerce / Consumer ─────────────────────────────────────────────────
  ['shopify',                 { category: 'Consumer & Retail', subcategory: 'E-Commerce',                confidence: 0.99 }],
  ['ebay',                    { category: 'Consumer & Retail', subcategory: 'E-Commerce',                confidence: 0.99 }],
  ['wayfair',                 { category: 'Consumer & Retail', subcategory: 'E-Commerce',                confidence: 0.99 }],
  ['etsy',                    { category: 'Consumer & Retail', subcategory: 'E-Commerce',                confidence: 0.99 }],
  ['doordash',                { category: 'Startups', subcategory: 'Marketplace Startups',              confidence: 0.95 }],
  ['instacart',               { category: 'Startups', subcategory: 'Marketplace Startups',              confidence: 0.95 }],
  ['grubhub',                 { category: 'Consumer & Retail', subcategory: 'Food Delivery',             confidence: 0.99 }],
  ['gopuff',                  { category: 'Consumer & Retail', subcategory: 'Food Delivery',             confidence: 0.99 }],
  ['target',                  { category: 'Consumer & Retail', subcategory: 'Retail Chains',             confidence: 0.99 }],
  ['walmart',                 { category: 'Consumer & Retail', subcategory: 'Retail Chains',             confidence: 0.99 }],
  ['costco',                  { category: 'Consumer & Retail', subcategory: 'Retail Chains',             confidence: 0.99 }],
  ['best buy',                { category: 'Consumer & Retail', subcategory: 'Retail Chains',             confidence: 0.99 }],
  ['nike',                    { category: 'Fashion & Apparel', subcategory: 'Sportswear',                confidence: 0.99 }],
  ['adidas',                  { category: 'Fashion & Apparel', subcategory: 'Sportswear',                confidence: 0.99 }],
  ['lululemon',               { category: 'Fashion & Apparel', subcategory: 'Sportswear',                confidence: 0.99 }],
  ['starbucks',               { category: 'Food & Beverage', subcategory: 'Restaurant Chains',           confidence: 0.99 }],
  ['mcdonalds',               { category: 'Food & Beverage', subcategory: 'Restaurant Chains',           confidence: 0.99 }],
  ['mcdonald\'s',             { category: 'Food & Beverage', subcategory: 'Restaurant Chains',           confidence: 0.99 }],
  ['beyond meat',             { category: 'Food & Beverage', subcategory: 'Alternative Protein / FoodTech', confidence: 0.99 }],
  ['impossible foods',        { category: 'Food & Beverage', subcategory: 'Alternative Protein / FoodTech', confidence: 0.99 }],

  // ── Logistics & Supply Chain ──────────────────────────────────────────────
  ['fedex',                   { category: 'Logistics & Supply Chain', subcategory: 'Shipping & Delivery', confidence: 0.99 }],
  ['ups',                     { category: 'Logistics & Supply Chain', subcategory: 'Shipping & Delivery', confidence: 0.99 }],
  ['dhl',                     { category: 'Logistics & Supply Chain', subcategory: 'Shipping & Delivery', confidence: 0.99 }],
  ['flexport',                { category: 'Logistics & Supply Chain', subcategory: 'Supply Chain Tech',   confidence: 0.99 }],
  ['project44',               { category: 'Logistics & Supply Chain', subcategory: 'Supply Chain Tech',   confidence: 0.99 }],
  ['samsara',                 { category: 'Logistics & Supply Chain', subcategory: 'Supply Chain Tech',   confidence: 0.99 }],
  ['convoy',                  { category: 'Logistics & Supply Chain', subcategory: 'Supply Chain Tech',   confidence: 0.99 }],

  // ── Education ─────────────────────────────────────────────────────────────
  ['duolingo',                { category: 'Education', subcategory: 'EdTech',                            confidence: 0.99 }],
  ['coursera',                { category: 'Education', subcategory: 'EdTech',                            confidence: 0.99 }],
  ['udemy',                   { category: 'Education', subcategory: 'EdTech',                            confidence: 0.99 }],
  ['chegg',                   { category: 'Education', subcategory: 'EdTech',                            confidence: 0.99 }],
  ['khan academy',            { category: 'Education', subcategory: 'EdTech',                            confidence: 0.99 }],
  ['2u',                      { category: 'Education', subcategory: 'EdTech',                            confidence: 0.90 }],

  // ── HR & Workforce ────────────────────────────────────────────────────────
  ['gusto',                   { category: 'HR & Workforce', subcategory: 'Payroll Platforms',            confidence: 0.99 }],
  ['rippling',                { category: 'Startups', subcategory: 'B2B SaaS Startups',                 confidence: 0.99 }],
  ['adp',                     { category: 'HR & Workforce', subcategory: 'Payroll Platforms',            confidence: 0.99 }],

  // ── Real Estate ───────────────────────────────────────────────────────────
  ['zillow',                  { category: 'Real Estate', subcategory: 'Mortgage Tech',                   confidence: 0.99 }],
  ['opendoor',                { category: 'Real Estate', subcategory: 'Mortgage Tech',                   confidence: 0.99 }],
  ['redfin',                  { category: 'Real Estate', subcategory: 'Mortgage Tech',                   confidence: 0.99 }],
  ['cbre',                    { category: 'Real Estate', subcategory: 'Commercial Real Estate',          confidence: 0.99 }],
  ['jll',                     { category: 'Real Estate', subcategory: 'Commercial Real Estate',          confidence: 0.99 }],

  // ── Telecom ───────────────────────────────────────────────────────────────
  ['at&t',                    { category: 'Telecom & Connectivity', subcategory: 'Mobile Carriers',       confidence: 0.99 }],
  ['verizon',                 { category: 'Telecom & Connectivity', subcategory: 'Mobile Carriers',       confidence: 0.99 }],
  ['t-mobile',                { category: 'Telecom & Connectivity', subcategory: 'Mobile Carriers',       confidence: 0.99 }],
  ['starlink',                { category: 'Telecom & Connectivity', subcategory: 'Satellite Internet',    confidence: 0.99 }],
  ['viasat',                  { category: 'Telecom & Connectivity', subcategory: 'Satellite Internet',    confidence: 0.99 }],
  ['astranis',                { category: 'Telecom & Connectivity', subcategory: 'Satellite Internet',    confidence: 0.99 }],

  // ── Accounting ───────────────────────────────────────────────────────────
  ['deloitte',                { category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.99 }],
  ['kpmg',                    { category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.99 }],
  ['pwc',                     { category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.99 }],
  ['pricewaterhousecoopers',  { category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.99 }],
  ['ernst & young',           { category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.99 }],
  ['ey',                      { category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.99 }],
  ['grant thornton',          { category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.99 }],
  ['bdo',                     { category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.90 }],

  // ── Non-profit ────────────────────────────────────────────────────────────
  ['mozilla',                 { category: 'Non-profit & Research', subcategory: 'Open Source Foundations', confidence: 0.99 }],
  ['linux foundation',        { category: 'Non-profit & Research', subcategory: 'Open Source Foundations', confidence: 0.99 }],
  ['wikimedia',               { category: 'Non-profit & Research', subcategory: 'NGOs / INGOs',           confidence: 0.99 }],

  // ── YC Companies / Notable Startups ──────────────────────────────────────────
  ['replit',              { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['cursor',              { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['anysphere',           { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['railway',             { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['render',              { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['supabase',            { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['planetscale',         { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['neon',                { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.95 }],
  ['turso',               { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.95 }],
  ['clerk',               { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['workos',              { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['resend',              { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['raycast',             { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['cal.com',             { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['posthog',             { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['sentry',              { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['dagger',              { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.95 }],
  ['modal',               { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.95 }],
  ['fly.io',              { category: 'Startups', subcategory: 'Dev Tools Startups',    confidence: 0.99 }],
  ['ramp',                { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.99 }],
  ['brex',                { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.99 }],
  ['mercury',             { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.99 }],
  ['deel',                { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.99 }],
  ['lattice',             { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.95 }],
  ['loom',                { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.99 }],
  ['superhuman',          { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.99 }],
  ['arc',                 { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.90 }],
  ['perplexity',          { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['perplexity ai',       { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['together ai',         { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['together.ai',         { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['runway',              { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['runway ml',           { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['pika',                { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.95 }],
  ['udio',                { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.95 }],
  ['midjourney',          { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['luma ai',             { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['eleven labs',         { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['elevenlabs',          { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['synthesia',           { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['rime',                { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.90 }],
  ['moonshot ai',         { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['kimi',                { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.90 }],
  ['pika labs',           { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['harvey',              { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.95 }],
  ['sierra',              { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.90 }],
  ['typeface',            { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.90 }],
  ['coframe',             { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.90 }],
  ['speak',               { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.90 }],
  ['otter.ai',            { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.95 }],
  ['glean',               { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.99 }],
  ['hebbia',              { category: 'Startups', subcategory: 'AI Startups',          confidence: 0.95 }],
  ['vanta',               { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.99 }],
  ['drata',               { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.99 }],
  ['secureframe',         { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.95 }],
  ['finix',               { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.95 }],
  ['lithic',              { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.95 }],
  ['modern treasury',     { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.99 }],
  ['highnote',            { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.90 }],
  ['column',              { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.90 }],
  ['navan',               { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.99 }],
  ['ramp business',       { category: 'Startups', subcategory: 'Fintech Startups',      confidence: 0.99 }],
  ['affinity',            { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.90 }],
  ['lumos',               { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.90 }],
  ['watershed',           { category: 'Startups', subcategory: 'Climate Startups',      confidence: 0.99 }],
  ['arcadia',             { category: 'Startups', subcategory: 'Climate Startups',      confidence: 0.90 }],
  ['pachama',             { category: 'Startups', subcategory: 'Climate Startups',      confidence: 0.90 }],
  ['terra',               { category: 'Startups', subcategory: 'Climate Startups',      confidence: 0.90 }],
  ['charm industrial',    { category: 'Startups', subcategory: 'Climate Startups',      confidence: 0.95 }],
  ['osmo',                { category: 'Startups', subcategory: 'Deep Tech Startups',    confidence: 0.90 }],
  ['isomorphic labs',     { category: 'Startups', subcategory: 'Deep Tech Startups',    confidence: 0.99 }],
  ['recursion',           { category: 'Startups', subcategory: 'Deep Tech Startups',    confidence: 0.99 }],
  ['recursion pharmaceuticals', { category: 'Startups', subcategory: 'Deep Tech Startups', confidence: 0.99 }],
  ['atomic ai',           { category: 'Startups', subcategory: 'Deep Tech Startups',    confidence: 0.95 }],
  ['genesis therapeutics',{ category: 'Startups', subcategory: 'Deep Tech Startups',    confidence: 0.95 }],
  ['alchemy',             { category: 'Startups', subcategory: 'Web3 Startups',         confidence: 0.99 }],
  ['privy',               { category: 'Startups', subcategory: 'Web3 Startups',         confidence: 0.90 }],
  ['dynamic',             { category: 'Startups', subcategory: 'Web3 Startups',         confidence: 0.85 }],
  ['faire',               { category: 'Startups', subcategory: 'Marketplace Startups',  confidence: 0.99 }],
  ['taskus',              { category: 'Startups', subcategory: 'B2B SaaS Startups',    confidence: 0.90 }],
  ['clipboard health',    { category: 'Startups', subcategory: 'HealthTech Startups',   confidence: 0.99 }],
  ['nomi health',         { category: 'Startups', subcategory: 'HealthTech Startups',   confidence: 0.90 }],
  ['accolade',            { category: 'Startups', subcategory: 'HealthTech Startups',   confidence: 0.90 }],
  ['cityblock health',    { category: 'Startups', subcategory: 'HealthTech Startups',   confidence: 0.99 }],
  ['grow therapy',        { category: 'Startups', subcategory: 'HealthTech Startups',   confidence: 0.95 }],
]);

// ─── Level 1: Title/keyword rules ────────────────────────────────────────────
// Applied FIRST — runs instantly with no API calls.
// Uses the combined text of name + jobTitle + jobDescription.

const KEYWORD_RULES = [
  { match: ['quantitative trad', 'quant trad', 'quant researcher', 'quant developer', 'algo trad', 'hft ', 'high frequency trad', 'market maker', 'market making'], category: 'Finance & Investing', subcategory: 'Quant Funds',               confidence: 0.72 },
  { match: ['investment bank', 'capital markets', 'bulge bracket', 'securities division', 'investment banking'], category: 'Finance & Investing', subcategory: 'Investment Banks',    confidence: 0.72 },
  { match: ['prop trading', 'proprietary trading'],                                         category: 'Finance & Investing', subcategory: 'Prop Trading Firms',      confidence: 0.72 },
  { match: ['hedge fund', 'multi-strategy fund', 'long/short'],                            category: 'Finance & Investing', subcategory: 'Hedge Funds',              confidence: 0.70 },
  { match: ['asset management', 'portfolio management', 'fund manager', 'mutual fund'],    category: 'Finance & Investing', subcategory: 'Asset Management',         confidence: 0.70 },
  { match: ['payment processing', 'payment systems', 'payment platform', 'card network'],  category: 'Finance & Investing', subcategory: 'Payments & Payment Processors', confidence: 0.70 },
  { match: ['fintech', 'financial technology', 'neobank', 'digital banking'],             category: 'Finance & Investing', subcategory: 'Fintech',                  confidence: 0.68 },
  { match: ['cryptocurrency exchange', 'crypto exchange', 'digital asset exchange'],       category: 'Finance & Investing', subcategory: 'Crypto Exchanges',         confidence: 0.72 },
  { match: ['blockchain infrastructure', 'web3 infrastructure', 'defi protocol'],         category: 'Finance & Investing', subcategory: 'Blockchain Infrastructure', confidence: 0.70 },
  { match: ['venture capital', 'vc fund', 'seed stage'],                                  category: 'Finance & Investing', subcategory: 'Venture Capital',          confidence: 0.70 },
  { match: ['private equity', 'buyout fund', 'leveraged buyout'],                         category: 'Finance & Investing', subcategory: 'Private Equity',           confidence: 0.70 },

  { match: ['foundation model', 'large language model', 'llm research', 'ai research lab', 'ai safety', 'generative ai lab'], category: 'AI & Research', subcategory: 'AI Labs', confidence: 0.72 },
  { match: ['mlops', 'ml platform', 'ai infrastructure', 'model serving', 'gpu cloud'],   category: 'AI & Research', subcategory: 'AI Infrastructure',             confidence: 0.70 },
  { match: ['machine learning engineer', 'ml engineer', 'computer vision', 'nlp engineer', 'applied ai', 'applied machine learning'], category: 'AI & Research', subcategory: 'Applied AI', confidence: 0.65 },
  { match: ['robotics software', 'autonomous systems', 'robot perception', 'embodied ai'], category: 'AI & Research', subcategory: 'Robotics AI',                   confidence: 0.70 },
  { match: ['ai chip', 'neural chip', 'ml accelerator', 'ai processor'],                  category: 'AI & Research', subcategory: 'AI Chip Makers',                confidence: 0.72 },

  { match: ['semiconductor', 'chip design', 'fabless', 'wafer', 'integrated circuit', 'vlsi', 'asic', 'fpga'],  category: 'Hardware & Semiconductors', subcategory: 'Semiconductor Manufacturers', confidence: 0.72 },
  { match: ['embedded software', 'firmware engineer', 'hardware engineer', 'pcb design'],  category: 'Hardware & Semiconductors', subcategory: 'Consumer Electronics',confidence: 0.65 },
  { match: ['network engineer', 'network software', 'routing protocol', 'switching'],      category: 'Hardware & Semiconductors', subcategory: 'Networking Hardware', confidence: 0.65 },

  { match: ['data engineer', 'data pipeline', 'analytics platform', 'data infrastructure', 'data platform'], category: 'Data & Analytics', subcategory: 'Data Infrastructure', confidence: 0.68 },
  { match: ['business intelligence', 'bi engineer', 'reporting platform'],                 category: 'Data & Analytics', subcategory: 'Business Intelligence Platforms', confidence: 0.68 },
  { match: ['market data', 'financial data provider', 'index provider'],                   category: 'Data & Analytics', subcategory: 'Market Data Providers',      confidence: 0.68 },

  { match: ['defense contractor', 'military systems', 'weapons system', 'department of defense', ' dod ', 'national security', 'c4isr'], category: 'Defense & Government', subcategory: 'Defense Contractors', confidence: 0.72 },
  { match: ['govtech', 'government technology', 'defense tech startup'],                   category: 'Defense & Government', subcategory: 'GovTech / Defense Tech',  confidence: 0.68 },

  { match: ['pharma', 'pharmaceutical', 'drug discovery', 'clinical trial', 'clinical development'], category: 'Healthcare & Life Sciences', subcategory: 'Pharma', confidence: 0.72 },
  { match: ['biotech', 'biologics', 'genomics', 'crispr', 'cell therapy', 'gene therapy'],category: 'Healthcare & Life Sciences', subcategory: 'Biotech',            confidence: 0.72 },
  { match: ['medical device', 'surgical robot', 'diagnostics hardware', 'implantable'],    category: 'Healthcare & Life Sciences', subcategory: 'Medical Devices',    confidence: 0.72 },
  { match: ['health tech', 'digital health', 'healthtech', 'electronic health record'],    category: 'Healthcare & Life Sciences', subcategory: 'Health Tech',        confidence: 0.68 },

  { match: ['electric vehicle', 'ev battery', 'ev software', 'ev powertrain'],             category: 'Automotive & Mobility', subcategory: 'Electric Vehicles',       confidence: 0.72 },
  { match: ['autonomous vehicle', 'self-driving', 'lidar', 'autonomous driving'],          category: 'Automotive & Mobility', subcategory: 'Autonomous Vehicles',     confidence: 0.72 },
  { match: ['aerospace software', 'satellite software', 'space systems', 'launch vehicle'], category: 'Automotive & Mobility', subcategory: 'Aerospace & Space',       confidence: 0.70 },
  { match: ['ride-sharing', 'rideshare', 'ride hailing'],                                  category: 'Automotive & Mobility', subcategory: 'Ride-sharing',            confidence: 0.70 },

  { match: ['video game', 'game studio', 'game engine', 'game developer', 'gameplay engineer'], category: 'Media & Entertainment', subcategory: 'Gaming',           confidence: 0.72 },
  { match: ['streaming service', 'video streaming', 'music streaming', 'ott platform'],    category: 'Media & Entertainment', subcategory: 'Streaming',              confidence: 0.70 },
  { match: ['social media platform', 'social network', 'user-generated content'],          category: 'Media & Entertainment', subcategory: 'Social Media',           confidence: 0.70 },
  { match: ['ad tech', 'adtech', 'programmatic advertising', 'demand side platform', 'dsp '], category: 'Media & Entertainment', subcategory: 'Ad Tech',             confidence: 0.70 },

  { match: ['e-commerce', 'ecommerce', 'online marketplace', 'marketplace platform'],      category: 'Consumer & Retail', subcategory: 'E-Commerce',                 confidence: 0.68 },
  { match: ['food delivery', 'meal delivery', 'restaurant delivery'],                      category: 'Consumer & Retail', subcategory: 'Food Delivery',              confidence: 0.70 },

  { match: ['logistics software', 'supply chain tech', 'freight tech', 'last mile delivery'], category: 'Logistics & Supply Chain', subcategory: 'Supply Chain Tech', confidence: 0.68 },
  { match: ['shipping software', 'parcel delivery'],                                        category: 'Logistics & Supply Chain', subcategory: 'Shipping & Delivery',  confidence: 0.65 },

  { match: ['renewable energy', 'solar panel', 'wind energy', 'clean energy', 'clean power'], category: 'Energy & Climate', subcategory: 'Renewables',             confidence: 0.70 },
  { match: ['climate tech', 'carbon capture', 'cleantech', 'green tech'],                  category: 'Energy & Climate', subcategory: 'Climate Tech',               confidence: 0.68 },
  { match: ['energy storage', 'battery technology', 'grid storage'],                       category: 'Energy & Climate', subcategory: 'Energy Storage',             confidence: 0.70 },
  { match: ['oil and gas', 'petroleum', 'upstream oil', 'offshore drilling'],              category: 'Energy & Climate', subcategory: 'Oil & Gas',                  confidence: 0.70 },

  { match: ['edtech', 'online learning', 'education platform', 'learning management'],     category: 'Education', subcategory: 'EdTech',                            confidence: 0.70 },

  { match: ['hr tech', 'human resources platform', 'talent management', 'recruiting software'], category: 'HR & Workforce', subcategory: 'HR Tech',               confidence: 0.68 },
  { match: ['payroll software', 'payroll platform'],                                        category: 'HR & Workforce', subcategory: 'Payroll Platforms',            confidence: 0.70 },
  { match: ['staffing', 'temp agency', 'recruiting agency'],                               category: 'HR & Workforce', subcategory: 'Staffing & Recruiting Agencies', confidence: 0.68 },

  { match: ['cybersecurity', 'information security', 'endpoint security', 'threat detection', 'soc analyst'], category: 'Tech & Software', subcategory: 'Cybersecurity', confidence: 0.70 },
  { match: ['developer tools', 'developer experience', 'devtools', 'sdk engineer', 'ci/cd'], category: 'Tech & Software', subcategory: 'Developer Tools',          confidence: 0.68 },
  { match: ['cloud provider', 'cloud infrastructure', 'iaas', 'paas platform'],            category: 'Tech & Software', subcategory: 'Cloud Providers',             confidence: 0.68 },
  { match: ['enterprise software', 'b2b saas', 'enterprise saas'],                        category: 'Tech & Software', subcategory: 'Enterprise Software',          confidence: 0.65 },

  { match: ['real estate technology', 'proptech', 'mortgage tech', 'real estate platform'], category: 'Real Estate', subcategory: 'Mortgage Tech',                 confidence: 0.68 },

  { match: ['satellite internet', 'low earth orbit', 'leo satellite'],                     category: 'Telecom & Connectivity', subcategory: 'Satellite Internet',    confidence: 0.70 },

  { match: ['big four', 'audit firm', 'accounting firm', 'public accounting'],             category: 'Accounting & Audit', subcategory: 'Big Four Firms',           confidence: 0.68 },
  { match: ['tax technology', 'tax platform', 'tax software'],                             category: 'Accounting & Audit', subcategory: 'Tax Tech',                 confidence: 0.68 },

  { match: ['bioinformatics', 'computational biology', 'genomic data'],                    category: 'Emerging & Niche', subcategory: 'BioInformatics',             confidence: 0.70 },
  { match: ['space tech', 'smallsat', 'cubesat'],                                          category: 'Emerging & Niche', subcategory: 'SpaceTech',                  confidence: 0.70 },
  { match: ['agritech', 'precision agriculture', 'agricultural technology'],               category: 'Emerging & Niche', subcategory: 'AgriTech',                   confidence: 0.70 },
  { match: ['insurtech', 'insurance technology', 'insurance platform'],                    category: 'Emerging & Niche', subcategory: 'InsurTech',                  confidence: 0.70 },
  { match: ['industrial robotics', 'industrial automation', 'factory automation'],         category: 'Manufacturing & Industrials', subcategory: 'Industrial Robotics', confidence: 0.70 },
];

function keywordClassify(text) {
  const t = text.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.match.some(kw => t.includes(kw))) {
      return { category: rule.category, subcategory: rule.subcategory, confidence: rule.confidence };
    }
  }
  return null;
}

/**
 * Fast, synchronous classifier — L1 keyword rules + L2 known-company map only.
 * No Wikipedia fetch, no AI call. Safe to run in a tight loop inside a serverless
 * function during a scrape (60s budget). Returns null if the classifier has no
 * opinion — caller should fall back to whatever context category the user was in.
 */
export function classifyFast(company) {
  if (!company || !company.name) return null;
  const title = [company.name, company.jobTitle || company.role || '', company.jobDescription || company.description || ''].join(' ');
  const kw = keywordClassify(title);
  if (kw) return kw;
  const known = KNOWN_COMPANIES.get(normalizeForLookup(company.name)) || KNOWN_COMPANIES.get(company.name.toLowerCase());
  return known || null;
}

// Normalize company name for lookup — strips common suffixes, lowercased
function normalizeForLookup(name) {
  return name
    .toLowerCase()
    .replace(/\b(inc\.?|llc\.?|ltd\.?|corp\.?|plc\.?|s\.a\.?|ag|gmbh|pte\.?\s*ltd\.?|incorporated|limited|corporation)\b\.?/gi, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Wikipedia enrichment ─────────────────────────────────────────────────────

const wikiCache = new Map(); // session-level cache

async function getWikipediaSummary(companyName) {
  const key = companyName.toLowerCase();
  if (wikiCache.has(key)) return wikiCache.get(key);

  // Build name variants to try in order
  const variants = [companyName];
  const stripped = companyName
    .replace(/\b(Inc\.?|LLC\.?|Ltd\.?|Corp\.?|Group|Holdings|Technologies|Technology|Solutions|Services|Systems|Labs?|Software|Global|International|Digital|Ventures|Capital|Partners|Associates|Consulting|Innovations?)\.?$/gi, '')
    .trim();
  if (stripped && stripped !== companyName && stripped.length > 2) variants.push(stripped);
  const firstTwo = companyName.split(/\s+/).slice(0, 2).join(' ');
  if (firstTwo !== companyName && firstTwo !== stripped && firstTwo.length > 2) variants.push(firstTwo);

  for (const name of variants) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.extract) {
        const summary = data.extract.slice(0, 500);
        wikiCache.set(key, summary);
        return summary;
      }
    } catch {}
  }

  wikiCache.set(key, '');
  return '';
}

// ─── Classifier prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a strict company industry classifier for a CS internship portal.

For each company, use its name, job title, job description, AND Wikipedia summary to determine what the company actually does. Do not classify based on the scrape search query — classify based on what the company is.

Rules:
- Return ONLY a valid JSON array. No explanation, no markdown, no code fences.
- Use ONLY categories and subcategories from the taxonomy below, spelled exactly as written.
- Confidence reflects certainty: 0.90+ = certain, 0.70-0.89 = good match, 0.50-0.69 = probable, 0.35-0.49 = best guess.
- NEVER output category "Unclassified". Always pick the most likely match, even if uncertain.
- If you cannot determine the company with confidence, output confidence 0.40 and pick the closest match.
- A bank is not a quant fund. A game company is not fintech. A defense contractor is not Big Tech. Be strict.

Taxonomy:
Finance & Investing: Quant Funds, Hedge Funds, Investment Banks, Asset Management, Prop Trading Firms, Retail Brokerages, Private Equity, Venture Capital, Insurance, Fintech, Payments & Payment Processors, Crypto Exchanges, Blockchain Infrastructure, Stablecoin Issuers, Digital Wallets
Tech & Software: Big Tech / FAANG, Enterprise Software, Cloud Providers, Developer Tools, Cybersecurity, SaaS
AI & Research: AI Labs, AI Infrastructure, Applied AI, Robotics AI, AI Chip Makers
Hardware & Semiconductors: Semiconductor Manufacturers, Consumer Electronics, Networking Hardware, Storage & Memory
Data & Analytics: Data Brokers, Business Intelligence Platforms, Data Infrastructure, Market Data Providers
Automotive & Mobility: Legacy Auto, Electric Vehicles, Autonomous Vehicles, Ride-sharing, Aerospace & Space
Healthcare & Life Sciences: Pharma, Biotech, Health Tech, Medical Devices, Health Insurance
Energy & Climate: Oil & Gas, Renewables, Energy Storage, Climate Tech
Consumer & Retail: E-Commerce, CPG / FMCG, Retail Chains, Food Delivery, Luxury Goods
Food & Beverage: Food Manufacturing, Restaurant Chains, Alternative Protein / FoodTech, Beverage Companies
Fashion & Apparel: Fast Fashion, Sportswear, Fashion Tech
Media & Entertainment: Gaming, Streaming, Social Media, Ad Tech, Podcast Networks, News Media, Book Publishing, Academic Publishing
Sports & Fitness: Sports Tech, Fitness Tech / Wearables, Sports Franchises, Esports Organizations
Travel & Hospitality: Airlines, Hotels & Lodging, Online Travel Agencies, Short-term Rentals
Logistics & Supply Chain: Shipping & Delivery, Supply Chain Tech, Warehousing
Manufacturing & Industrials: Heavy Manufacturing, Industrial Automation, 3D Printing / Additive Manufacturing, Industrial Robotics
Chemical & Materials: Specialty Chemicals, Advanced Materials, Plastics & Polymers
Construction & Infrastructure: Civil Engineering Firms, Smart Infrastructure, Building Materials
Real Estate: Commercial Real Estate, REITs, Mortgage Tech, Property Management
Telecom & Connectivity: Mobile Carriers, Satellite Internet, Fiber Providers, IoT Connectivity
Defense & Government: Defense Contractors, GovTech / Defense Tech
HR & Workforce: HR Tech, Staffing & Recruiting Agencies, Payroll Platforms, Background Check Services
Marketing & Creative: Creative Agencies, PR Firms, Market Research Firms, Influencer / Creator Platforms
Legal & Compliance: Law Firms, Compliance Tech, Regulatory Consulting, LegalTech
Accounting & Audit: Big Four Firms, Accounting Software, Tax Tech
Education: EdTech, Academic Research Institutions, Academic Publishing
Non-profit & Research: Think Tanks, NGOs / INGOs, Open Source Foundations
Emerging & Niche: SpaceTech, AgriTech, PropTech, BioInformatics, ClimateTech / GreenTech, InsurTech, RegTech, WealthTech, MedTech, NanoTechnology

Input:
[{ "name": "Roblox", "jobTitle": "Software Engineer Intern", "jobDescription": "game platform...", "wikipedia": "Roblox is an online game platform and game creation system..." }]

Output:
[{ "name": "Roblox", "category": "Media & Entertainment", "subcategory": "Gaming", "confidence": 0.97 }]`;

// ─── JSON parser ──────────────────────────────────────────────────────────────

function parseJSON(text) {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

function buildInput(batch) {
  return JSON.stringify(batch.map(c => ({
    name:           c.name,
    jobTitle:       c.jobTitle        || c.role        || '',
    jobDescription: c.jobDescription  || c.description || '',
    wikipedia:      c.wikipedia       || '',
  })));
}

// ─── Provider call ────────────────────────────────────────────────────────────
// Bulk label assignment: the cheapest model that returns clean JSON (see
// services/llm.js ROUTES.categorize). One retry on malformed JSON.
async function classifyBatch(batch, batchNum, totalBatches) {
  const label = `Batch ${batchNum}/${totalBatches}`;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await complete({ task: 'categorize', system: SYSTEM_PROMPT, user: buildInput(batch), json: true, maxTokens: 6000 });
      console.log(`[Classifier/${r.provider}] ${label} — OK (attempt ${attempt})`);
      return { results: parseJSON(r.text), provider: r.provider };
    } catch (err) {
      lastErr = err;
      if (err.name === 'BudgetExceededError' || !/JSON|parse|syntax|unexpected/i.test(err.message)) break;
      console.warn(`[Classifier] ${label} — malformed JSON, retrying...`);
    }
  }
  console.error(`[Classifier] ${label} — ${lastErr.message}`);
  throw lastErr;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * 4-level classification:
 *   L1. Keyword rules on name+title+description (instant, ~60% coverage)
 *   L2. Known-companies map (instant, ~25% coverage)
 *   L3. Wikipedia enrichment + Gemini/Claude batch (API calls, remaining unknowns)
 *   L4. Scrape-context fallback — NEVER mark Unclassified
 *
 * @param {Array<{ name, jobTitle?, jobDescription?, role?, description? }>} companies
 * @param {{ category?: string, subcategory?: string } | null} scrapeContext
 * @returns {Promise<Map<string, { category, subcategory, confidence, classified_at, wikipedia }>>}
 */
export async function classifyCompanies(companies, scrapeContext = null) {
  if (!companies.length) return new Map();

  const now       = new Date().toISOString();
  const resultMap = new Map();
  const needsAI   = []; // companies not resolved by L1 or L2

  let l1Count = 0, l2Count = 0;

  // ── Level 1 & 2: instant (no API) ───────────────────────────────────────
  for (const c of companies) {
    const key = c.name.toLowerCase();

    // L1: keyword rules on combined text
    const titleText = [c.name, c.jobTitle || c.role || '', c.jobDescription || c.description || ''].join(' ');
    const kw = keywordClassify(titleText);
    if (kw) {
      resultMap.set(key, { ...kw, classified_at: now, wikipedia: '' });
      l1Count++;
      continue;
    }

    // L2: known companies map
    const norm = normalizeForLookup(c.name);
    const known = KNOWN_COMPANIES.get(norm) || KNOWN_COMPANIES.get(key);
    if (known) {
      resultMap.set(key, { ...known, classified_at: now, wikipedia: '' });
      l2Count++;
      continue;
    }

    needsAI.push(c);
  }

  console.log(`[classifier] L1=${l1Count} L2=${l2Count} needsAI=${needsAI.length} of ${companies.length}`);
  if (needsAI.length === 0) return resultMap;

  // ── Level 3: Wikipedia enrichment + AI ──────────────────────────────────
  console.log(`[classifier] enriching ${needsAI.length} companies via Wikipedia...`);
  const enriched = await Promise.all(needsAI.map(async (c) => ({
    ...c,
    wikipedia: await getWikipediaSummary(c.name),
  })));

  // Second pass: keyword rules WITH Wikipedia text for companies that had no title signal
  const forAI = [];
  let l1WikiCount = 0;
  for (const c of enriched) {
    if (!c.wikipedia) { forAI.push(c); continue; }
    const key = c.name.toLowerCase();
    const fullText = [c.name, c.jobTitle || c.role || '', c.jobDescription || c.description || '', c.wikipedia].join(' ');
    const kw = keywordClassify(fullText);
    if (kw) {
      resultMap.set(key, { ...kw, classified_at: now, wikipedia: c.wikipedia });
      l1WikiCount++;
    } else {
      forAI.push(c);
    }
  }
  if (l1WikiCount > 0) console.log(`[classifier] L1+wiki=${l1WikiCount} (wikipedia helped)`);

  // Batch through AI
  const BATCH_SIZE   = 20;
  const MAX_PARALLEL = 5;
  const batches      = [];
  for (let i = 0; i < forAI.length; i += BATCH_SIZE) {
    batches.push(forAI.slice(i, i + BATCH_SIZE));
  }

  const needsL4 = []; // companies AI couldn't resolve

  for (let i = 0; i < batches.length; i += MAX_PARALLEL) {
    const chunk = batches.slice(i, i + MAX_PARALLEL);
    await Promise.all(chunk.map(async (batch, chunkIdx) => {
      const batchNum = i + chunkIdx + 1;
      try {
        const { results, provider } = await classifyBatch(batch, batchNum, batches.length);
        const lookup = new Map(results.map(r => [(r.name || '').toLowerCase(), r]));

        // Detect silently dropped items — retry just those once.
        const dropped = batch.filter(c => !lookup.has(c.name.toLowerCase()));
        if (dropped.length > 0) {
          console.warn(`[Classifier/${provider}] Batch ${batchNum} — ${dropped.length} items dropped, retrying them...`);
          try {
            const { results: retry } = await classifyBatch(dropped, batchNum, batches.length);
            for (const r of retry) lookup.set((r.name || '').toLowerCase(), r);
          } catch {}
        }

        let classified = 0, lowConf = 0;

        for (const c of batch) {
          const key  = c.name.toLowerCase();
          const r    = lookup.get(key);
          const conf = r?.confidence ?? 0;
          // Accept any non-Unclassified result from AI (it's instructed to never output Unclassified)
          const isOk = r && r.category && r.category !== 'Unclassified' && conf >= 0.35;

          if (isOk) {
            resultMap.set(key, {
              category:      r.category,
              subcategory:   r.subcategory,
              confidence:    conf,
              classified_at: now,
              wikipedia:     c.wikipedia || '',
            });
            classified++;
            if (conf < 0.50) lowConf++;
          } else {
            needsL4.push(c);
          }
        }

        console.log(`[Classifier/${provider}] Batch ${batchNum}/${batches.length} — ${classified} classified (${lowConf} low-conf), ${batch.length - classified} → L4`);
      } catch {
        for (const c of batch) needsL4.push(c);
        console.warn(`[Classifier] Batch ${batchNum}/${batches.length} — both providers failed, ${batch.length} → L4`);
      }
    }));
  }

  // ── Level 4: scrape-context or keyword-only fallback — NEVER Unclassified ─
  if (needsL4.length > 0) {
    console.log(`[Classifier/L4] applying fallback to ${needsL4.length} companies`);
    for (const c of needsL4) {
      const key = c.name.toLowerCase();
      // Last-chance keyword on full text with wikipedia
      const fullText = [c.name, c.jobTitle || c.role || '', c.jobDescription || c.description || '', c.wikipedia || ''].join(' ');
      const kw = keywordClassify(fullText);
      if (kw) {
        resultMap.set(key, { ...kw, confidence: Math.max(kw.confidence - 0.10, 0.35), classified_at: now, wikipedia: c.wikipedia || '' });
        continue;
      }

      // Use scrape context if we know how the company was discovered
      if (scrapeContext?.subcategory) {
        // Find category for this subcategory from CATEGORIES taxonomy
        const catEntry = ALL_CATEGORY_LOOKUP.get(scrapeContext.subcategory);
        if (catEntry) {
          resultMap.set(key, {
            category: catEntry.category, subcategory: scrapeContext.subcategory,
            confidence: 0.38, classified_at: now, wikipedia: c.wikipedia || '',
          });
          continue;
        }
      }
      if (scrapeContext?.category) {
        // Pick the first subcategory of the given category
        const catEntry = ALL_CATEGORY_FIRST_SUB.get(scrapeContext.category);
        if (catEntry) {
          resultMap.set(key, {
            category: scrapeContext.category, subcategory: catEntry,
            confidence: 0.36, classified_at: now, wikipedia: c.wikipedia || '',
          });
          continue;
        }
      }

      // Absolute fallback — default to Tech & Software / SaaS (most common for CS interns)
      resultMap.set(key, {
        category: 'Tech & Software', subcategory: 'SaaS',
        confidence: 0.35, classified_at: now, wikipedia: c.wikipedia || '',
      });
    }
    console.log(`[Classifier/L4] done — all ${needsL4.length} assigned, 0 Unclassified`);
  }

  return resultMap;
}

// ─── Subcategory lookup for L4 fallback ──────────────────────────────────────

const ALL_CATEGORY_LOOKUP = new Map([
  ['Quant Funds', { category: 'Finance & Investing' }],
  ['Hedge Funds', { category: 'Finance & Investing' }],
  ['Investment Banks', { category: 'Finance & Investing' }],
  ['Asset Management', { category: 'Finance & Investing' }],
  ['Prop Trading Firms', { category: 'Finance & Investing' }],
  ['Retail Brokerages', { category: 'Finance & Investing' }],
  ['Private Equity', { category: 'Finance & Investing' }],
  ['Venture Capital', { category: 'Finance & Investing' }],
  ['Insurance', { category: 'Finance & Investing' }],
  ['Fintech', { category: 'Finance & Investing' }],
  ['Payments & Payment Processors', { category: 'Finance & Investing' }],
  ['Crypto Exchanges', { category: 'Finance & Investing' }],
  ['Blockchain Infrastructure', { category: 'Finance & Investing' }],
  ['Big Tech / FAANG', { category: 'Tech & Software' }],
  ['Enterprise Software', { category: 'Tech & Software' }],
  ['Cloud Providers', { category: 'Tech & Software' }],
  ['Developer Tools', { category: 'Tech & Software' }],
  ['Cybersecurity', { category: 'Tech & Software' }],
  ['SaaS', { category: 'Tech & Software' }],
  ['AI Labs', { category: 'AI & Research' }],
  ['AI Infrastructure', { category: 'AI & Research' }],
  ['Applied AI', { category: 'AI & Research' }],
  ['Robotics AI', { category: 'AI & Research' }],
  ['AI Chip Makers', { category: 'AI & Research' }],
  ['Semiconductor Manufacturers', { category: 'Hardware & Semiconductors' }],
  ['Consumer Electronics', { category: 'Hardware & Semiconductors' }],
  ['Networking Hardware', { category: 'Hardware & Semiconductors' }],
  ['Storage & Memory', { category: 'Hardware & Semiconductors' }],
  ['Data Infrastructure', { category: 'Data & Analytics' }],
  ['Business Intelligence Platforms', { category: 'Data & Analytics' }],
  ['Market Data Providers', { category: 'Data & Analytics' }],
  ['Data Brokers', { category: 'Data & Analytics' }],
  ['Electric Vehicles', { category: 'Automotive & Mobility' }],
  ['Autonomous Vehicles', { category: 'Automotive & Mobility' }],
  ['Ride-sharing', { category: 'Automotive & Mobility' }],
  ['Legacy Auto', { category: 'Automotive & Mobility' }],
  ['Aerospace & Space', { category: 'Automotive & Mobility' }],
  ['Pharma', { category: 'Healthcare & Life Sciences' }],
  ['Biotech', { category: 'Healthcare & Life Sciences' }],
  ['Health Tech', { category: 'Healthcare & Life Sciences' }],
  ['Medical Devices', { category: 'Healthcare & Life Sciences' }],
  ['Health Insurance', { category: 'Healthcare & Life Sciences' }],
  ['Oil & Gas', { category: 'Energy & Climate' }],
  ['Renewables', { category: 'Energy & Climate' }],
  ['Energy Storage', { category: 'Energy & Climate' }],
  ['Climate Tech', { category: 'Energy & Climate' }],
  ['E-Commerce', { category: 'Consumer & Retail' }],
  ['CPG / FMCG', { category: 'Consumer & Retail' }],
  ['Retail Chains', { category: 'Consumer & Retail' }],
  ['Food Delivery', { category: 'Consumer & Retail' }],
  ['Gaming', { category: 'Media & Entertainment' }],
  ['Streaming', { category: 'Media & Entertainment' }],
  ['Social Media', { category: 'Media & Entertainment' }],
  ['Ad Tech', { category: 'Media & Entertainment' }],
  ['Shipping & Delivery', { category: 'Logistics & Supply Chain' }],
  ['Supply Chain Tech', { category: 'Logistics & Supply Chain' }],
  ['Defense Contractors', { category: 'Defense & Government' }],
  ['GovTech / Defense Tech', { category: 'Defense & Government' }],
  ['HR Tech', { category: 'HR & Workforce' }],
  ['Payroll Platforms', { category: 'HR & Workforce' }],
  ['Staffing & Recruiting Agencies', { category: 'HR & Workforce' }],
  ['EdTech', { category: 'Education' }],
  ['Big Four Firms', { category: 'Accounting & Audit' }],
  ['Tax Tech', { category: 'Accounting & Audit' }],
  ['Commercial Real Estate', { category: 'Real Estate' }],
  ['Mortgage Tech', { category: 'Real Estate' }],
  ['Mobile Carriers', { category: 'Telecom & Connectivity' }],
  ['Satellite Internet', { category: 'Telecom & Connectivity' }],
  ['Industrial Robotics', { category: 'Manufacturing & Industrials' }],
  ['Industrial Automation', { category: 'Manufacturing & Industrials' }],
  ['BioInformatics', { category: 'Emerging & Niche' }],
  ['SpaceTech', { category: 'Emerging & Niche' }],
  ['AgriTech', { category: 'Emerging & Niche' }],
  ['InsurTech', { category: 'Emerging & Niche' }],
  // ── Startups ──────────────────────────────────────────────────────────────
  ['YC Companies', { category: 'Startups' }],
  ['Series A', { category: 'Startups' }],
  ['Series B', { category: 'Startups' }],
  ['Pre-Seed / Seed', { category: 'Startups' }],
  ['Dev Tools Startups', { category: 'Startups' }],
  ['AI Startups', { category: 'Startups' }],
  ['Fintech Startups', { category: 'Startups' }],
  ['HealthTech Startups', { category: 'Startups' }],
  ['Climate Startups', { category: 'Startups' }],
  ['Consumer Startups', { category: 'Startups' }],
  ['B2B SaaS Startups', { category: 'Startups' }],
  ['Web3 Startups', { category: 'Startups' }],
  ['Marketplace Startups', { category: 'Startups' }],
  ['Deep Tech Startups', { category: 'Startups' }],
]);

const ALL_CATEGORY_FIRST_SUB = new Map([
  ['Finance & Investing', 'Fintech'],
  ['Tech & Software', 'SaaS'],
  ['AI & Research', 'Applied AI'],
  ['Hardware & Semiconductors', 'Semiconductor Manufacturers'],
  ['Data & Analytics', 'Data Infrastructure'],
  ['Automotive & Mobility', 'Electric Vehicles'],
  ['Healthcare & Life Sciences', 'Health Tech'],
  ['Energy & Climate', 'Climate Tech'],
  ['Consumer & Retail', 'E-Commerce'],
  ['Media & Entertainment', 'Streaming'],
  ['Logistics & Supply Chain', 'Supply Chain Tech'],
  ['Defense & Government', 'GovTech / Defense Tech'],
  ['HR & Workforce', 'HR Tech'],
  ['Education', 'EdTech'],
  ['Accounting & Audit', 'Big Four Firms'],
  ['Real Estate', 'Mortgage Tech'],
  ['Telecom & Connectivity', 'Mobile Carriers'],
  ['Manufacturing & Industrials', 'Industrial Automation'],
  ['Emerging & Niche', 'SpaceTech'],
  ['Startups', 'AI Startups'],
]);
