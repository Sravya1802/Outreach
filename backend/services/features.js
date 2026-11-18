// Resumes come from the Claude chat runs now. IN_APP_TAILORING=on brings the
// app's own resume writer back. Outreach has no switch: the app writes no
// emails or notes at all; the user's Claude run writes them.
export const inAppTailoring = () => process.env.IN_APP_TAILORING === 'on';
