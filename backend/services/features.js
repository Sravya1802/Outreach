// Resumes and outreach come from the Claude chat runs now. These bring the app's
// own versions back: IN_APP_TAILORING=on, IN_APP_EMAILS=on.
export const inAppTailoring = () => process.env.IN_APP_TAILORING === 'on';
export const inAppEmails = () => process.env.IN_APP_EMAILS === 'on';
