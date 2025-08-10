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
    
    const apiUrl = `https://oebb.macistry.com/api/journeys?from=${fromId}&to=${toId}`;
    console.log(`🌐 ÖBB Transport REST API: ${apiUrl}`);
    
    const response = await axios.get(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
    
    console.log(`📨 API response: ${response.data ? JSON.stringify(response.data).length : 0} chars`);
    
    if (response.data && response.data.journeys) {
      const trains = parseTransportRestData(response.data.journeys);
      if (trains && trains.length > 0) {
        console.log(`✅ Successfully parsed ${trains.length} real trains`);
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
  
  if (fromStation === 'Linz' && toStation === 'St. Pölten') {
    // Linz → St. Pölten schedule
    const baseSchedule = [
      { hour: 6, minute: 7, type: 'RJ', number: 'RJ 541' },
      { hour: 7, minute: 7, type: 'RJ', number: 'RJ 543' },
      { hour: 8, minute: 7, type: 'RJ', number: 'RJ 545' },
      { hour: 9, minute: 7, type: 'RJ', number: 'RJ 547' },
      { hour: 10, minute: 7, type: 'RJ', number: 'RJ 549' },
      { hour: 11, minute: 7, type: 'RJ', number: 'RJ 551' },
      { hour: 12, minute: 7, type: 'RJ', number: 'RJ 553' },
      { hour: 12, minute: 37, type: 'WB', number: 'WB 8653' },
      { hour: 13, minute: 7, type: 'RJ', number: 'RJ 555' },
      { hour: 13, minute: 37, type: 'WB', number: 'WB 8655' },
      { hour: 14, minute: 7, type: 'RJ', number: 'RJ 557' },
      { hour: 14, minute: 37, type: 'WB', number: 'WB 8657' },
      { hour: 15, minute: 7, type: 'RJ', number: 'RJ 559' },
      { hour: 15, minute: 37, type: 'WB', number: 'WB 8659' },
      { hour: 16, minute: 7, type: 'RJ', number: 'RJ 561' },
      { hour: 16, minute: 37, type: 'WB', number: 'WB 8661' },
      { hour: 17, minute: 7, type: 'RJ', number: 'RJ 563' },
      { hour: 17, minute: 37, type: 'WB', number: 'WB 8663' },
      { hour: 18, minute: 7, type: 'RJ', number: 'RJ 565' },
      { hour: 18, minute: 37, type: 'WB', number: 'WB 8665' },
      { hour: 19, minute: 7, type: 'RJ', number: 'RJ 567' },
      { hour: 19, minute: 37, type: 'WB', number: 'WB 8667' },
      { hour: 20, minute: 7, type: 'RJ', number: 'RJ 569' },
      { hour: 21, minute: 7, type: 'RJ', number: 'RJ 571' },
      { hour: 22, minute: 7, type: 'RJ', number: 'RJ 573' }
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
          platform: schedule.type === 'WB' ? '3' : '4'
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
  
  console.log('🚄 Vercel API Request: Linz → St. Pölten');
  
  try {
    const trains = await fetchOebbTransportRest('Linz', 'St. Pölten');
    
    res.status(200).json({
      route: "Linz → St. Pölten",
      timestamp: new Date().toISOString(),
      trains: trains,
      source: 'oebb-transport-rest-vercel',
      realTimeData: true,
      success: true
    });
    
  } catch (error) {
    console.error(`❌ Transport REST API failed: ${error.message}`);
    
    const fallbackData = getRealisticFallback('Linz', 'St. Pölten');
    
    res.status(200).json({
      route: "Linz → St. Pölten",
      timestamp: new Date().toISOString(),
      trains: fallbackData,
      source: 'realistic-fallback-vercel',
      realTimeData: false,
      success: false,
      error: error.message
    });
  }
}