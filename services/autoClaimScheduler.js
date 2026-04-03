import { supabase } from '../config/supabase.js';

const WORKER_ID = '11111111-1111-1111-1111-111111111111';
const CITY = 'Bangalore';
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;

const checkWeatherAndAutoClaim = async () => {
  if (!OPENWEATHER_KEY) {
    console.warn('[AUTO-CLAIM] No OPENWEATHER_API_KEY found, skipping weather check.');
    return;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${CITY}&appid=${OPENWEATHER_KEY}&units=metric`;
    const res = await fetch(url);
    const wx = await res.json();

    if (!wx.main) {
      console.warn('[AUTO-CLAIM] Bad weather API response:', wx.message);
      return;
    }

    const rainfall = wx.rain?.['1h'] || 0;
    const temp = wx.main.temp;

    console.log(`[AUTO-CLAIM] ${CITY} weather: Rain=${rainfall}mm, Temp=${temp}°C`);

    const shouldTrigger = rainfall > 20 || temp > 42;

    if (shouldTrigger) {
      const reason = `Auto-Claim: Live weather alert for ${CITY} (Rain: ${rainfall}mm, Temp: ${temp}°C)`;
      console.log(`[AUTO-CLAIM] Conditions met! Filing claim for worker ${WORKER_ID}`);

      const { error } = await supabase.from('claims').insert([{
        worker_id: WORKER_ID,
        amount: 80,
        reason,
        status: 'APPROVED',
        created_at: new Date(),
      }]);

      if (error) {
        console.error('[AUTO-CLAIM DB ERROR]', error.message);
      } else {
        console.log('[AUTO-CLAIM] ✅ Claim auto-filed successfully.');
      }
    } else {
      console.log('[AUTO-CLAIM] Conditions not met, no claim filed.');
    }
  } catch (err) {
    console.error('[AUTO-CLAIM] Error checking weather:', err.message);
  }
};

export const startAutoClaimScheduler = () => {
  console.log('[AUTO-CLAIM] Scheduler started. Checking every 15 minutes.');
  // Run once immediately on startup
  checkWeatherAndAutoClaim();
  // Then every 15 minutes
  setInterval(checkWeatherAndAutoClaim, 15 * 60 * 1000);
};
