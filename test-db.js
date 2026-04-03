
import 'dotenv/config';
import { supabase } from './config/supabase.js';

async function run() {
  console.log('Testing insert...');
  const { data, error } = await supabase.from('claims').insert([{
    worker_id: '11111111-1111-1111-1111-111111111111',
    amount: 100,
    reason: 'test',
    status: 'APPROVED'
  }]);
  console.log('RESULT:', JSON.stringify({data, error}, null, 2));
}
run();

