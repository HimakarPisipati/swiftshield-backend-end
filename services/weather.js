import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

export async function checkWeather(lat, lon) {
  if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY === 'mock-key') {
     // Return mock data if no key configured
     return {
        rainfall: 25,
        temp: 30,
        aqi: 50,
        isMocked: true,
        condition: 'Heavy Rain'
     };
  }

  try {
     const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`);
     
     // basic mapping to mm/hr if rain object exists
     const rainfall = res.data.rain ? (res.data.rain['1h'] || 0) : 0;
     const temp = res.data.main.temp;
     const condition = res.data.weather[0]?.main;

     return {
        rainfall,
        temp,
        aqi: 50, // mock AQI unless using separate air pollution endpoint
        isMocked: false,
        condition
     };
  } catch (error) {
     console.error('Weather API Error:', error.message);
     return { rainfall: 0, temp: 25, aqi: 50, isMocked: true, condition: 'Clear' };
  }
}
