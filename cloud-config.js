// GIDEON CLOUD dashboard settings (served at /cloud-config.js). Nothing here is secret.
// The Firebase web config below is the same public config the server's admin dashboard already ships; it
// identifies the Firebase Authentication project used for sign-in. Never put a Session ID in this file.
window.GIDEON_CLOUD = {
  // Empty = the dashboard talks to the bot it is served from (the normal setup).
  // Only set this if the page is hosted on a different domain, and then add that domain to cloud.allowedOrigins in config.local.json.
  API_BASE: '',
  PAIR_URL: 'https://praise-pair.onrender.com/',
  FIREBASE: {
    apiKey: 'AIzaSyDmPX8X4v2pWyilJuw8tJMWud2miPgFr0o',
    projectId: 'gideon-e2265'
  },
  ENDPOINTS: {
    capabilities: '/api/cloud/capabilities',
    list: '/api/cloud/bots',
    connect: '/api/cloud/bots',
    bot: '/api/cloud/bots/{id}',
    action: '/api/cloud/bots/{id}/{action}',
    remove: '/api/cloud/bots/{id}',
    logs: '/api/cloud/bots/{id}/logs'
  }
}
