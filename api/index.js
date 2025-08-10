// Vercel serverless function handler for root endpoint
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  res.status(200).json({
    message: 'ÖBB Proxy Vercel - Transport REST API (Real Data)',
    description: 'Uses real ÖBB Transport REST API for live train data',
    endpoints: [
      '/api/trains/stpoelten-linz',
      '/api/trains/linz-stpoelten'
    ],
    version: '1.0.0-vercel',
    features: ['Real-time data', 'Actual delays', 'Live departures', 'Serverless (no cold starts)', 'Sorted by actual departure time']
  });
}