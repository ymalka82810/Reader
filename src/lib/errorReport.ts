/** plain-text crash report the user can paste to the developer; no book names, no URL query or hash */
export function errorReport(error: Error, componentStack = ''): string {
  return [
    `${error.name}: ${error.message}`,
    error.stack ?? '',
    componentStack && `Component stack:${componentStack}`,
    `Page: ${location.origin}${location.pathname}`,
    `Browser: ${navigator.userAgent}`,
    `Time: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
