import axios from 'axios';

let isApiInProgress = false;

// Helpers copied from the other file (keep identical) -----------------
function parseHafasDateTime(dt) {
  if (!dt) return null;
  const s = String(dt);
  let y, m, d, hh = '00', mm = '00';
  if (s.length === 12) { y = s.slice(0,4); m = s.slice(4,6); d = s.slice(6,8); hh = s.slice(8,10); mm = s.slice(10,12); }
  else if (s.length === 14) { y = s.slice(0,4); m = s.slice(4,6); d = s.slice(6,8); hh = s.slice(8,10); mm = s.slice(10,12); }
  else if (s.length === 8) { y = s.slice(0,4); m = s.slice(4,6); d = s.slice(6,8); }
  else return null;
  return new Date(`${y}-${m}-${d}T${hh}:${mm}:00`);
}
function minutesBetween(later, earlier) { if (!later || !earlier) return 0; return Math.round((later - earlier)/60000); }
function toClock(date) { return date ? date.toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit', timeZone:'Europe/Vienna'}) : '?'; }
function normalizeTrainFields({ depReal, depPlan, arrReal, arrPlan, prodName, lineName, platfReal, platfPlan }) {
  const actualDep = depReal || depPlan;
  const actualArr = arrReal || arrPlan;
  const delayMin = Math.max(0, minutesBetween(actualDep, depPlan));
  const status = delayMin > 0 ? (delayMin <= 5 ? 'slightly-delayed' : 'delayed') : 'on-time';
  const depPlat = platfReal || platfPlan || '?';
  const platform = depPlat;
  const trainNumber = lineName || prodName || 'RJ ???';
  const trainType = (prodName && prodName.split(' ')[0]) || (trainNumber && trainNumber.split(' ')[0]) || 'RJ';
  return { departure: toClock(actualDep), arrival: toClock(actualArr), trainType, trainNumber, delay: delayMin, status, platform, _sortA: actualDep };
}
// ---------------------------------------------------------------------

async function fetchOebbHafasMgate(fromName, toName) {
  const AID = process.env.HAFAS_AID;
  if (!AID) return null;

  const body = {
    lang: "deu",
    ver: "1.61",
    auth: { aid: AID },
    client: { id: "OEBB", type: "WEB", name: "webapp", v: "1.0" },
    svcReqL: [{
      req: {
        depLocL: [{ name: fromName }],
        arrLocL: [{ name: toName }],
        getIST: true,
        jnyFltrL: [{ type: "PROD", mode: "INC", value: "1111111111111111" }],
        outFrwd: true,
        numF: 5
      },
      meth: "TripSearch"
    }],
    ext: "OEBB.1"
  };

  const url = 'https://fahrplan.oebb.at/bin/mgate.exe';
  const res = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000
  });

  const svc = res.data && res.data.svcResL && res.data.svcResL[0];
  if (!svc || !svc.res || !svc.res.outConL) return [];

  const out = [];
  for (const con of svc.res.outConL) {
    if (!con.secL || !con.secL.length) continue;
    const leg = con.secL[0];
    const prod = (leg.jny && leg.jny.prod) || {};
    const dep = leg.dep || {};
    const arr = leg.arr || {};

    const depPlan = parseHafasDateTime(dep.dTimeS || dep.timeS);
    const depReal = parseHafasDateTime(dep.dTimeR || dep.timeR);
    const arrPlan = parseHafasDateTime(arr.aTimeS || arr.timeS);
    const arrReal = parseHafasDateTime(arr.aTimeR || arr.timeR);

    const platfPlan = (dep.dPlatfS && dep.dPlatfS.txt) || (dep.dPlatfS && dep.dPlatfS.name) || dep.dPlatfS || dep.platfS || null;
    const platfReal = (dep.dPlatfR && dep.dPlatfR.txt) || (dep.dPlatfR && dep.dPlatfR.name) || dep.dPlatfR || dep.platfR || null;

    const prodName = prod.name;
    const lineName = leg.name || prod.line || null;

    out.push(normalizeTrainFields({ depReal, depPlan, arrReal, arrPlan, prodName, lineName, platfReal, platfPlan }));
  }

  out.sort((a, b) => (a._sortA?.getTime?.() || 0) - (b._sortA?.getTime?.() || 0));
  return out.slice(0, 3).map(({ _sortA, ...t }) => t);
}

async function fetchOebbTransportRestOrQuery(fromStation, toStation) {
  let fromId, toId;
  if (fromStation === 'St. Pölten' && toStation === 'Linz') {
    fromId = '8100008';
    toId = '8100013';
  } else {
    fromId = '8100013';
    toId = '8100008';
  }

  const currentDate = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const currentTime = new Date().toTimeString().slice(0,5).replace(':', '');

  const apis = [
    `https://fahrplan.oebb.at/bin/query.exe/dny?S=Linz+Hbf&Z=St.+P%C3%B6lten+Hbf&date=${currentDate}&time=${currentTime}&start=1&prod=1111111111111111&REQ0JourneyStopsS0A=1&REQ0JourneyStopsZ0A=1&output=json`,
    `https://v6.db.transport.rest/journeys?from=${fromId}&to=${toId}&results=5`,
    `https://oebb.macistry.com/api/journeys?from=${fromId}&to=${toId}`,
    `https://v5.db.transport.rest/journeys?from=${fromId}&to=${toId}&results=5`
  ];

  let response = null;
  for (const apiUrl of apis) {
    try {
      const r = await axios.get(apiUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
      if (r.data && (r.data.journeys || r.data.routes)) {
        response = { data: r.data, apiUsed: apiUrl };
        break;
      }
    } catch {}
  }
  if (!response) throw new Error('All APIs failed');

  return parseTransportRestData(response.data);
}

function parseTransportRestData(journeysContainer) {
  try {
    const journeys = journeysContainer.journeys || journeysContainer.routes || [];
    const trains = [];
    for (const journey of journeys) {
      if (!journey.legs || journey.legs.length === 0) continue;
      const leg = journey.legs[0];
      if (!leg || !leg.line) continue;

      const actualDepartureDate = new Date(leg.departure);
      const plannedDepartureDate = new Date(leg.plannedDeparture || leg.departure);
      const arrivalDate = new Date(leg.arrival);

      const departureTime = toClock(actualDepartureDate);
      const arrivalTime = toClock(arrivalDate);

      const delaySec = leg.departureDelay || 0;
      const delay = Math.floor(delaySec / 60);
      const status = delay > 0 ? (delay <= 5 ? 'slightly-delayed' : 'delayed') : 'on-time';

      const trainType = leg.line.productName || 'RJ';
      const trainNumber = leg.line.name || `${trainType} ???`;

      const departurePlatform =
        leg.departurePlatform ||
        (leg.departure && leg.departure.platform) ||
        (leg.departure && leg.departure.plannedPlatform) || null;

      const arrivalPlatform =
        leg.arrivalPlatform ||
        (leg.arrival && leg.arrival.platform) ||
        (leg.arrival && leg.arrival.plannedPlatform) || null;

      let platform = '?';
      if (departurePlatform && arrivalPlatform) platform = `${departurePlatform} → ${arrivalPlatform}`;
      else if (departurePlatform) platform = departurePlatform;
      else if (arrivalPlatform) platform = arrivalPlatform;

      trains.push({ departure: departureTime, arrival: arrivalTime, trainType, trainNumber, delay, status, platform, _sortA: actualDepartureDate });
    }
    trains.sort((a, b) => (a._sortA?.getTime?.() || 0) - (b._sortA?.getTime?.() || 0));
    return trains.slice(0,3).map(({ _sortA, ...t }) => t);
  } catch (e) {
    console.error('❌ Error parsing Transport REST/Scotty data:', e);
    return [];
  }
}

async function fetchOebb(fromStation, toStation) {
  if (isApiInProgress) throw new Error('API call in progress - please wait');
  isApiInProgress = true;
  try {
    const mgate = await fetchOebbHafasMgate('Linz Hbf', 'St. Pölten Hbf');
    if (mgate && mgate.length) return mgate;
    return await fetchOebbTransportRestOrQuery(fromStation, toStation);
  } finally {
    isApiInProgress = false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  console.log('🚄 Vercel API Request: Linz → St. Pölten');
  try {
    const trains = await fetchOebb('Linz', 'St. Pölten');
    res.status(200).json({
      route: "Linz → St. Pölten",
      timestamp: new Date().toISOString(),
      trains,
      source: trains && trains.length ? 'oebb-hafas-mgate|query+transport.rest' : 'unknown',
      realTimeData: true,
      success: true
    });
  } catch (error) {
    console.error(`❌ API failed: ${error.message}`);
    res.status(500).json({
      route: "Linz → St. Pölten",
      timestamp: new Date().toISOString(),
      trains: [],
      source: 'none - all APIs failed',
      realTimeData: false,
      success: false,
      error: error.message
    });
  }
}
