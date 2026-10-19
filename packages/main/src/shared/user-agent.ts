/**
 * Removes the Electron and application tokens from a user agent, leaving the
 * shape a plain Chrome would send. The application token is the product name in
 * a packaged build and the package name in development, so every spelling is
 * stripped, case-insensitively.
 */
export function anonymizeUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s*(?:@?akagi-ng(?:-desktop|\/main)?|Electron)\/\S+/gi, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}
