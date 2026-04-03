const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixDb() {
  console.log("Re-inserting Demo Worker...");
  const { data, error } = await supabase.from('workers').upsert({
    id: '11111111-1111-1111-1111-111111111111',
    full_name: 'Demo Worker',
    vehicle_type: 'Bike',
    active_plan: 'Standard',
    risk_score: 10
  });

  if (error) {
    console.error("Failed to insert worker. Error:", error);
  } else {
    console.log("Success! Worker '11111111-1111-1111-1111-111111111111' is back in the database.");
  }
}

fixDb();
