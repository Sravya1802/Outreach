const REQUIRED = ['PORT'];
const OPTIONAL_AI = ['GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
const OPTIONAL_INTEGRATIONS = ['APIFY_API_TOKEN', 'APOLLO_API_KEY', 'HUNTER_API_KEY', 'LINKEDIN_SESSION_COOKIE'];
const OPTIONAL_OTHER = ['STARTUP_SHEET_URL', 'AI_PROVIDER', 'CORS_ORIGINS'];

export function validateConfig() {
  const errors = [];
  const warnings = [];

  // Check required vars
  for (const key of REQUIRED) {
    if (!process.env[key]) {
      errors.push(`✗ Missing required env var: ${key}`);
    }
  }

  // Check AI provider
  const aiProviders = OPTIONAL_AI.filter(k => process.env[k]);
  if (aiProviders.length === 0) {
    warnings.push(`⚠ No AI provider configured. Set one of: ${OPTIONAL_AI.join(', ')}`);
  }

  // Check integrations
  const configured = OPTIONAL_INTEGRATIONS.filter(k => process.env[k]);
  if (configured.length === 0) {
    warnings.push(`⚠ No external integrations configured. Some features will be limited.`);
  }

  if (errors.length > 0) {
    console.error('\n🔴 Configuration Errors:');
    errors.forEach(e => console.error(e));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n🟡 Configuration Warnings:');
    warnings.forEach(w => console.warn(w));
  }

  console.log(`\n✓ Backend starting on port ${process.env.PORT}`);
  if (aiProviders.length > 0) {
    console.log(`✓ AI providers available: ${aiProviders.join(', ')}`);
  }
  if (configured.length > 0) {
    console.log(`✓ Integrations: ${configured.join(', ')}`);
  }
}
