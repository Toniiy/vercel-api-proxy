import axios from 'axios';

let isApiInProgress = false;

// ---------- Helpers for HAFAS mgate ----------
function parseHafasDateTime(dt) {
  // HAFAS time formats often like "20250812" + "073000" or compact "202508120730"
  if (!dt) return null;
  const s = String(dt);
  let y, m, d, hh = '00', mm = '00';
  if (s.length === 12) {          // YYYYMMDDHHMM
    y = s.slice(0,4); m = s.slice(4,6); d = s.slice(6,8);
    hh = s.slice(8,10); mm = s.slice(10,12);
  } else if (s.length === 14) {   // YYYYMMDDHHMMSS
    y = s.slice(0,4); m = s.slice(4,6); d = s.slice(6,8);
    hh = s.slice(8,10); mm = s.slice(10,12);
  } else if (s.length === 8) {    // YYYYMMDD (no time)
    y = s.slice(0,4); m = s.slice(4,6); d = s.slice(6,8);
  } else {
    return null;
  }
  // Europe/Vienna local time; create Date in that TZ via ISO without Z
  const iso = `${y}-${m}-${d}T${hh}:${mm}:00`;
  return new Date(iso); // serverless is UTC, but we only need local HH:MM via toLocaleTimeString with TZ
}

function minutesBetween(later, earlier) {
  if (!later || !earlier) return 0;
  const ms = later.getTime() - earlier.getTime();
  return Math.round(ms / 60000);
}

function toClock(date) {
  if (!date) return '?';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
}

function normalizeTrainFields({
  depReal, depPlan, arrReal, arrPlan,
  prodName, lineName,
  platfReal, platfPlan,
  arrPlatReal, arrPlatPlan
}) {
  const actualDep = depReal || depPlan;
  const actualArr = arrReal || arrPlan;

  // Delay: prefer dep delay; if not present, fall back to arrival delay
  let delayMin = 0;
  if (depPlan && depReal) delayMin = minutesBetween(depReal, depPlan);
  else if (arrPlan && arrReal) delayMin = minutesBetween(arrReal, arrPlan);

  const status = delayMin > 0 ? (delayMin <= 5 ? 'slightly-delayed' : 'delayed') : 'on-time';

  // Platform: combine dep and arr if available; else whichever exists
  const depPlat = platfReal || platfPlan || null;
  const arrPlat = arrPlatReal || arrPlatPlan || null;
  let platform = '?';
  if (depPlat && arrPlat) platform = `${depPlat} → ${arrPlat}`;
  else if (depPlat) platform = depPlat;
  else if (arrPlat) platform = arrPlat;

  const trainNumber = lineName || prodName || 'RJ ???';
  const trainType = (prodName && prodName.split(' ')[0]) || (trainNumber && trainNumber.split(' ')[0]) || 'RJ';

  return {
    departure: toClock(actualDep),
    arrival: toClock(actualArr),
    trainType,
    trainNumber,
    delay: Math.max(0, delayMin),
    status,
    platform,
    _sortA: actualDep
  };
}


// ---------- HAFAS mgate fetch ----------
async function fetchOebbHafasMgate(fromName, toName) {
  const AID = process.env.HAFAS_AID; // required; do not commit a real key
  if (!AID) return null; // feature-gate: only try mgate if configured

  const body = {
    lang: "deu",
    ver: "1.61",
    auth: { aid: AID },
    client: {
      id: "OEBB",
      type: "WEB",
      name: "webapp",
      v: "1.0"
    },
    // Trip request ("tripSearch") – same planner the webapp uses
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
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    },
    timeout: 10000
  });

  const svc = res.data && res.data.svcResL && res.data.svcResL[0];
  if (!svc || !svc.res || !svc.res.outConL) return [];

  const out = [];

  for (const con of svc.res.outConL) {
    if (!con.secL || !con.secL.length) continue;
    const leg = con.secL[0]; // first leg is our direct segment on this relation (we will still sort)
    const prod = (leg.jny && leg.jny.prod) || {};
    const dep = leg.dep || {};
    const arr = leg.arr || {};

    const depPlan = parseHafasDateTime(dep.dTimeS || dep.timeS);
    const depReal = parseHafasDateTime(dep.dTimeR || dep.timeR);
    const arrPlan = parseHafasDateTime(arr.aTimeS || arr.timeS);
    const arrReal = parseHafasDateTime(arr.aTimeR || arr.timeR);

    const platfPlan = (dep.dPlatfS && dep.dPlatfS.txt) || (dep.dPlatfS && dep.dPlatfS.name) || dep.dPlatfS || dep.platfS || null;
    const platfReal = (dep.dPlatfR && dep.dPlatfR.txt) || (dep.dPlatfR && dep.dPlatfR.name) || dep.dPlatfR || dep.platfR || null;

    const prodName = prod.name;   // e.g. "WB 8652" / "RJ 540"
    const lineName = leg.name || prod.line || null;

    out.push(normalizeTrainFields({
      depReal, depPlan, arrReal, arrPlan, prodName, lineName, platfReal, platfPlan
    }));
  }

  // sort by actual departure
  out.sort((a, b) => (a._sortA?.getTime?.() || 0) - (b._sortA?.getTime?.() || 0));
  // keep only first 3 & strip internals
  return out.slice(0, 3).map(({ _sortA, ...t }) => t);
}

// ---------- Existing flow (Scotty query.exe + transport.rest) ----------
async function fetchOebbTransportRestOrQuery(fromStation, toStation) {
  let fromId, toId;
  if (fromStation === 'St. Pölten' && toStation === 'Linz') {
    fromId = '8100008'; // St. Pölten Hbf
    toId = '8100013';   // Linz/Donau Hbf
  } else {
    fromId = '8100013'; // Linz/Donau Hbf
    toId = '8100008';   // St. Pölten Hbf
  }

  const currentDate = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const currentTime = new Date().toTimeString().slice(0,5).replace(':', '');    // HHMM

  const apis = [
    // Scotty JSON
    `https://fahrplan.oebb.at/bin/query.exe/dny?S=St.+P%C3%B6lten+Hbf&Z=Linz+Hbf&date=${currentDate}&time=${currentTime}&start=1&prod=1111111111111111&REQ0JourneyStopsS0A=1&REQ0JourneyStopsZ0A=1&output=json`,
    // transport.rest variants
    `https://v6.db.transport.rest/journeys?from=${fromId}&to=${toId}&results=5`,
    `https://oebb.macistry.com/api/journeys?from=${fromId}&to=${toId}`,
    `https://v5.db.transport.rest/journeys?from=${fromId}&to=${toId}&results=5`
  ];

  let response = null;
  for (const apiUrl of apis) {
    try {
      const r = await axios.get(apiUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      if (r.data && (r.data.journeys || r.data.routes)) {
        response = { data: r.data, apiUsed: apiUrl };
        break;
      }
    } catch {}
  }

  if (!response) throw new Error('All APIs failed');

  // Common parser for transport.rest-style shape (your original)
  return parseTransportRestData(response.data);
}

function parseTransportRestData(journeysContainer) {
  // works for transport.rest & Scotty query.exe when they expose journeys/legs with ISO datetimes
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

      trains.push({
        departure: departureTime,
        arrival: arrivalTime,
        trainType,
        trainNumber,
        delay,
        status,
        platform,
        _sortA: actualDepartureDate
      });
    }

    trains.sort((a, b) => (a._sortA?.getTime?.() || 0) - (b._sortA?.getTime?.() || 0));
    return trains.slice(0,3).map(({ _sortA, ...t }) => t);
  } catch (e) {
    console.error('❌ Error parsing Transport REST/Scotty data:', e);
    return [];
  }
}

// ---------- Unified fetch with mgate first ----------
async function fetchOebb(fromStation, toStation) {
  if (isApiInProgress) throw new Error('API call in progress - please wait');
  isApiInProgress = true;
  try {
    // 1) Try HAFAS mgate for best WB realtime (only if configured)
    const mgate = await fetchOebbHafasMgate('St. Pölten Hbf', 'Linz Hbf');
    if (mgate && mgate.length) return mgate;

    // 2) Fallback to your existing chain (Scotty query.exe + transport.rest)
    return await fetchOebbTransportRestOrQuery(fromStation, toStation);
  } finally {
    isApiInProgress = false;
  }
}

// ---------- Vercel handler ----------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  console.log('🚄 Vercel API Request: St. Pölten → Linz');

  try {
    const trains = await fetchOebb('St. Pölten', 'Linz');
    res.status(200).json({
      route: "St. Pölten → Linz",
      timestamp: new Date().toISOString(),
      trains,
      source: trains && trains.length ? 'oebb-hafas-mgate|query+transport.rest' : 'unknown',
      realTimeData: true,
      success: true
    });
  } catch (error) {
    console.error(`❌ API failed: ${error.message}`);
    res.status(500).json({
      route: "St. Pölten → Linz",
      timestamp: new Date().toISOString(),
      trains: [],
      source: 'none - all APIs failed',
      realTimeData: false,
      success: false,
      error: error.message
    });
  }
}
