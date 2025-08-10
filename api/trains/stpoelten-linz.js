import axios from 'axios';

let isApiInProgress = false;

async function fetchOebbTransportRest(fromStation, toStation) {
  if (isApiInProgress) {
    throw new Error('API call in progress - please wait');
  }
  
  isApiInProgress = true;
  console.log(`🚄 Fetching real ÖBB data: ${fromStation} → ${toStation}`);
  
  try {
    let fromId, toId;
    
    if (fromStation === 'St. Pölten' && toStation === 'Linz') {
      fromId = '8100008'; // St. Pölten Hbf
      toId = '8100013';   // Linz/Donau Hbf
    } else {
      fromId = '8100013'; // Linz/Donau Hbf
      toId = '8100008';   // St. Pölten Hbf
    }
    
    // Try multiple APIs in order
    const apis = [
      `https://v6.db.transport.rest/journeys?from=${fromId}&to=${toId}&results=5`,
      `https://oebb.macistry.com/api/journeys?from=${fromId}&to=${toId}`,
      `https://v5.db.transport.rest/journeys?from=${fromId}&to=${toId}&results=5`
    ];
    
    let response = null;
    let apiUsed = '';
    
    for (const apiUrl of apis) {
      try {
        console.log(`🌐 Trying API: ${apiUrl}`);
        response = await axios.get(apiUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000
        });
        
        if (response.data && (response.data.journeys || response.data.routes)) {
          apiUsed = apiUrl;
          console.log(`✅ API success: ${apiUrl}`);
          break;
        }
      } catch (err) {
        console.log(`❌ API failed: ${apiUrl} - ${err.message}`);
        continue;
      }
    }
    
    if (!response) {
      throw new Error('All APIs failed');
    }
    
    console.log(`📨 API response: ${response.data ? JSON.stringify(response.data).length : 0} chars`);
    
    if (response.data && (response.data.journeys || response.data.routes)) {
      const journeys = response.data.journeys || response.data.routes || [];
      const trains = parseTransportRestData(journeys, apiUsed);
      if (trains && trains.length > 0) {
        console.log(`✅ Successfully parsed ${trains.length} real trains from ${apiUsed}`);
        return trains;
      }
    }
    
    throw new Error('No journey data found in API response');
    
  } catch (error) {
    console.error(`❌ ÖBB Transport REST API failed: ${error.message}`);
    throw error;
  } finally {
    isApiInProgress = false;
  }
}

function parseTransportRestData(journeys) {
  try {
    console.log(`🔍 Parsing ${journeys.length} journeys from Transport REST API`);
    
    const trains = [];
    
    for (const journey of journeys) {
      if (!journey.legs || journey.legs.length === 0) continue;
      
      const leg = journey.legs[0]; // First leg is the direct train
      if (!leg.line || !leg.departure || !leg.arrival) continue;
      
      // Parse actual departure time (including delays)
      const actualDepartureDate = new Date(leg.departure);
      const plannedDepartureDate = new Date(leg.plannedDeparture || leg.departure);
      
      const departureTime = actualDepartureDate.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Vienna'
      });
      
      const arrivalTime = new Date(leg.arrival).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Vienna'
      });
      
      const delay = leg.departureDelay || 0;
      const status = delay > 0 ? (delay <= 5 ? 'slightly-delayed' : 'delayed') : 'on-time';
      
      const trainType = leg.line.productName || 'RJ';
      const trainNumber = leg.line.name || `${trainType} ???`;
      
      const platform = leg.departurePlatform || '?';
      
      trains.push({
        departure: departureTime,
        arrival: arrivalTime,
        trainType: trainType,
        trainNumber: trainNumber,
        delay: Math.floor(delay / 60), // Convert seconds to minutes
        status: status,
        platform: platform,
        actualDepartureTime: actualDepartureDate, // For sorting
        plannedDepartureTime: plannedDepartureDate
      });
      
      console.log(`✅ Parsed: ${trainNumber} planned:${plannedDepartureDate.toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'})} actual:${departureTime} (${Math.floor(delay / 60)}min delay)`);
    }
    
    // Sort by actual departure time (planned + delay)
    trains.sort((a, b) => a.actualDepartureTime.getTime() - b.actualDepartureTime.getTime());
    
    // Remove sorting fields and return only first 3
    const sortedTrains = trains.slice(0, 3).map(train => {
      const { actualDepartureTime, plannedDepartureTime, ...cleanTrain } = train;
      return cleanTrain;
    });
    
    console.log(`📊 Sorted ${sortedTrains.length} trains by actual departure time`);
    
    return sortedTrains;
    
  } catch (error) {
    console.error('❌ Error parsing Transport REST data:', error);
    return [];
  }
}

function getRealisticFallback(fromStation, toStation) {
  console.log(`🚂 Realistic ÖBB fallback: ${fromStation} → ${toStation}`);
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  const trains = [];
  
  if (fromStation === 'St. Pölten' && toStation === 'Linz') {
    // St. Pölten → Linz schedule
    const baseSchedule = [
      { hour: 6, minute: 42, type: 'RJ', number: 'RJ 540' },
      { hour: 7, minute: 42, type: 'RJ', number: 'RJ 542' },
      { hour: 8, minute: 42, type: 'RJ', number: 'RJ 544' },
      { hour: 9, minute: 42, type: 'RJ', number: 'RJ 546' },
      { hour: 10, minute: 42, type: 'RJ', number: 'RJ 548' },
      { hour: 11, minute: 42, type: 'RJ', number: 'RJ 550' },
      { hour: 12, minute: 12, type: 'WB', number: 'WB 8652' },
      { hour: 12, minute: 42, type: 'RJ', number: 'RJ 552' },
      { hour: 13, minute: 12, type: 'WB', number: 'WB 8654' },
      { hour: 13, minute: 42, type: 'RJ', number: 'RJ 554' },
      { hour: 14, minute: 12, type: 'WB', number: 'WB 8656' },
      { hour: 14, minute: 42, type: 'RJ', number: 'RJ 556' },
      { hour: 15, minute: 42, type: 'RJ', number: 'RJ 558' },
      { hour: 16, minute: 12, type: 'WB', number: 'WB 8658' },
      { hour: 16, minute: 42, type: 'RJ', number: 'RJ 560' },
      { hour: 17, minute: 12, type: 'WB', number: 'WB 8660' },
      { hour: 17, minute: 42, type: 'RJ', number: 'RJ 562' },
      { hour: 18, minute: 12, type: 'WB', number: 'WB 8662' },
      { hour: 18, minute: 42, type: 'RJ', number: 'RJ 564' },
      { hour: 19, minute: 12, type: 'WB', number: 'WB 8664' },
      { hour: 19, minute: 42, type: 'RJ', number: 'RJ 566' },
      { hour: 20, minute: 12, type: 'WB', number: 'WB 8666' },
      { hour: 20, minute: 42, type: 'RJ', number: 'RJ 568' },
      { hour: 21, minute: 42, type: 'RJ', number: 'RJ 570' },
      { hour: 22, minute: 42, type: 'RJ', number: 'RJ 572' }
    ];
    
    for (const schedule of baseSchedule) {
      const trainTime = schedule.hour * 60 + schedule.minute;
      const nowTime = currentHour * 60 + currentMinute;
      
      if (trainTime > nowTime && trains.length < 3) {
        const delay = Math.random() < 0.3 ? Math.floor(Math.random() * 8) : 0;
        const departureTime = `${schedule.hour.toString().padStart(2, '0')}:${schedule.minute.toString().padStart(2, '0')}`;
        const arrivalHour = schedule.hour + 1;
        const arrivalMinute = schedule.minute + 11;
        const adjustedArrivalHour = arrivalMinute >= 60 ? arrivalHour + 1 : arrivalHour;
        const adjustedArrivalMinute = arrivalMinute >= 60 ? arrivalMinute - 60 : arrivalMinute;
        const arrivalTime = `${adjustedArrivalHour.toString().padStart(2, '0')}:${adjustedArrivalMinute.toString().padStart(2, '0')}`;
        
        trains.push({
          departure: departureTime,
          arrival: arrivalTime,
          trainType: schedule.type,
          trainNumber: schedule.number,
          delay: delay,
          status: delay > 0 ? 'delayed' : 'on-time',
          platform: schedule.type === 'WB' ? '1' : '2'
        });
        
        console.log(`🚂 Fallback: ${schedule.number} ${departureTime} (${delay}min delay)`);
      }
    }
  }
  
  return trains;
}

// Vercel serverless function handler
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
  
  console.log('🚄 Vercel API Request: St. Pölten → Linz');
  
  try {
    const trains = await fetchOebbTransportRest('St. Pölten', 'Linz');
    
    res.status(200).json({
      route: "St. Pölten → Linz",
      timestamp: new Date().toISOString(),
      trains: trains,
      source: 'oebb-transport-rest-vercel',
      realTimeData: true,
      success: true
    });
    
  } catch (error) {
    console.error(`❌ Transport REST API failed: ${error.message}`);
    
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