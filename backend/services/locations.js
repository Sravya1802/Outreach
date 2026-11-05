// LinkedIn sometimes pairs a city with the wrong state ("Poughkeepsie, AR",
// "Santa Clara, TX"). These cities are only ever meant as one place in a job post.
const HOME_STATE = {
  atlanta: 'GA', austin: 'TX', boston: 'MA', chicago: 'IL', cupertino: 'CA', denver: 'CO', 'mountain view': 'CA', 'new york': 'NY',
  'palo alto': 'CA', poughkeepsie: 'NY', redmond: 'WA', 'san francisco': 'CA', 'san jose': 'CA', 'santa clara': 'CA', seattle: 'WA', sunnyvale: 'CA',
};

/** "City, ST" with its state corrected. A city and state in the title win, then the list above. */
export function fixLocation(location, title = '') {
  const m = String(location ?? '').match(/^([^,]+), ([A-Z]{2})$/);
  if (!m) return location;
  const [, city, state] = m;
  const named = String(title).match(new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, ([A-Z]{2})\\b`, 'i'));
  const right = named?.[1]?.toUpperCase() ?? HOME_STATE[city.trim().toLowerCase()] ?? state;
  return `${city}, ${right}`;
}
