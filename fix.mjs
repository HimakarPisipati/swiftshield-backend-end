import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fix() {
  const { error } = await supabase.from('workers').upsert({
    id: '11111111-1111-1111-1111-111111111111',
    full_name: 'Demo Worker',
    active_plan: 'Standard',
    risk_score: 10
  });
  if (error) console.error(error);
  else console.log('WORKER RESTORED');
}
fix();
