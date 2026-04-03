import express from 'express';
import { supabase } from '../config/supabase.js';

const router = express.Router();

// State to keep track of recent events (in-memory for simple hackathon fraud detection / cooldowns)
const recentEvents = {};
const failedDeliveries = {}; // track failed deliveries per worker per shift

// Endpoint: Simulate or receive real platform events
router.post('/simulate', async (req, res) => {
  const { eventType, userId, data, isMock } = req.body;
  // eventType expected: 'DELIVERY_ATTEMPT', 'LOCATION_UPDATE', 'WEATHER_UPDATE', 'SOCIAL_ALERT'
  
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  let payoutAmount = 0;
  let triggerReason = "";
  let fraudFlag = false;

  console.log(`[ENGINE] Received ${eventType} for User: ${userId} | Mock: ${isMock}`);

  // 1. Unlucky Situations (Platform + App Data Driven)
  if (eventType === 'DELIVERY_ATTEMPT') {
    if (data.status === 'FAILED') {
      if (!failedDeliveries[userId]) failedDeliveries[userId] = 0;
      failedDeliveries[userId] += 1;
      
      console.log(`[ENGINE] User ${userId} failed deliveries count: ${failedDeliveries[userId]}`);
      
      if (failedDeliveries[userId] >= 2) {
        triggerReason = "Unlucky Situation: >= 2 failed delivery attempts";
        payoutAmount = 40; // ₹40 payout
        
        // Anti-Fraud / Deduplication: don't payout continuously for the 3rd, 4th fail in a row unless cool down.
        const lastPayoutTime = recentEvents[`${userId}-unlucky`];
        if (lastPayoutTime && (Date.now() - lastPayoutTime < 3600000)) { // 1 hr cooldown
          fraudFlag = true;
          triggerReason += " (FRAUD FLAG: Cooldown not met)";
          payoutAmount = 0;
        } else {
          recentEvents[`${userId}-unlucky`] = Date.now();
        }
      }
    }
  }

  // 2. Unsafe Locations
  if (eventType === 'LOCATION_UPDATE') {
    // Check speed consistency (Fraud Detection)
    if (data.distanceMoved && data.timeElapsed) {
      const speed = data.distanceMoved / data.timeElapsed; // simple check
      if (speed > 50) { // Unrealistic speed (e.g. 50 meters/sec = 180 km/h)
        fraudFlag = true;
        console.warn(`[FRAUD ALERT] User ${userId} suspicious speed: ${speed} m/s`);
      }
    }

    if (data.inHighRiskZone && !fraudFlag) {
      triggerReason = "Unsafe Location: Entered high-risk zone";
      payoutAmount = 100; // ₹100 fixed payout
      
      const lastPayoutTime = recentEvents[`${userId}-unsafe`];
      if (lastPayoutTime && (Date.now() - lastPayoutTime < 7200000)) { // 2 hr cooldown
         fraudFlag = true;
         triggerReason += " (FRAUD: Cooldown)";
         payoutAmount = 0;
      } else {
         recentEvents[`${userId}-unsafe`] = Date.now();
      }
    }
  }

  // 3. Environmental Disruptions
  if (eventType === 'WEATHER_UPDATE') {
    if (data.rainfall > 20 || data.temp > 42 || data.aqi > 300) {
      triggerReason = `Environmental Disruption: Severe condition detected (Rain: ${data.rainfall}mm, Temp: ${data.temp}°C)`;
      payoutAmount = 80;
      recentEvents[`${userId}-weather`] = Date.now();
    }
  }

  // Process Payout if conditions met and no fraud flag
  if (payoutAmount > 0) {
    console.log(`[PAYOUT] Triggering payout of ₹${payoutAmount} for ${userId}. Reason: ${triggerReason}`);
    
    // In a real scenario, we save this to Supabase
    try {
      if (!isMock) {
        const { error } = await supabase.from('claims').insert([{
           worker_id: userId,
           amount: payoutAmount,
           reason: triggerReason,
           status: 'APPROVED',
           created_at: new Date()
        }]);
        if (error) {
           console.error("[DB ERROR] Insert failed:", error);
           return res.status(500).json({ error: error.message });
        }
      }
      return res.json({
        success: true,
         trigger: true,
         amount: payoutAmount,
         reason: triggerReason,
         fraudFlag
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "DB Error" });
    }
  }

  return res.json({ success: true, trigger: false, reason: 'No payout conditions met', fraudFlag });
});

// Endpoint to fetch real-time claims/stats for the dashboard
router.get('/stats/:userId', async (req, res) => {
  const { userId } = req.params;
  
  let totalClaims = 0;
  let recentPayouts = [];
  let activePlan = 'Standard';
  let weeklyPremium = 399;
  
  try {
    // 1. Fetch claims
    const { data: claims } = await supabase.from('claims').select('*').eq('worker_id', userId).order('created_at', { ascending: false });
    if (claims && claims.length > 0) {
       totalClaims = claims.reduce((acc, curr) => acc + curr.amount, 0);
       recentPayouts = claims;
    }

    // 2. Fetch worker info for plan details
    const { data: worker } = await supabase.from('workers').select('active_plan').eq('id', userId).single();
    if (worker) {
       activePlan = worker.active_plan || 'Standard';
       const premiumMap = { 'basic': 199, 'standard': 399, 'premium': 699 };
       weeklyPremium = premiumMap[activePlan.toLowerCase()] || 399;
       // Capitalize for display
       activePlan = activePlan.charAt(0).toUpperCase() + activePlan.slice(1);
    }
  } catch (e) {
    console.log("DB fetch failed, using default stats", e);
  }

  // --- Smart Risk Score Calculation ---
  // Two components:
  //   1. Recent activity (7-day rolling window) — high impact, decays quickly
  //   2. Lifetime history — low impact, represents long-term track record
  // This way: 100 deliveries + 10 old claims → low risk. 10 claims this week → high risk.

  const now = Date.now();
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

  const claimsLast7Days = recentPayouts.filter(p => new Date(p.created_at).getTime() > sevenDaysAgo).length;
  const claimsLast30Days = recentPayouts.filter(p => new Date(p.created_at).getTime() > thirtyDaysAgo).length;
  const allTimeClaimCount = recentPayouts.length;

  // Recent spike: each claim in the last 7 days heavily increases risk (resets when worker is active again)
  const recentRisk = claimsLast7Days * 18;         // Max ~90 if 5 claims in a week
  // Monthly trend: smaller contribution from last-30-day activity
  const monthlyRisk = claimsLast30Days * 4;         // Max ~40 for 10 claims/month
  // Lifetime baseline: very small long-term modifier (acknowledges history, not punishing)
  const lifetimeModifier = Math.min(8, allTimeClaimCount * 0.5); // Max +8 ever from lifetime

  const dynamicRiskScore = Math.min(95, Math.max(10, Math.round(
    10                  // Minimum baseline
    + recentRisk        // Main driver: what happened THIS week
    + monthlyRisk * 0.3 // Secondary: monthly trend
    + lifetimeModifier  // Tertiary: slight long-term awareness
  )));

  console.log(`[RISK] User ${userId}: 7d=${claimsLast7Days}, 30d=${claimsLast30Days}, lifetime=${allTimeClaimCount} → score=${dynamicRiskScore}`);

  // Return dynamic structured data
  return res.json({
     weeklyEarnings: 0,
     weeklyEarningsChange: '',
     lossCovered: totalClaims,
     activePlan: activePlan,
     weeklyPremium: weeklyPremium,
     riskScore: dynamicRiskScore,
     fraudAlerts: 0,
     recentPayouts: recentPayouts,
     earningsData: [],
     claimsData: [],
     activities: recentPayouts.map(p => ({
         type: "payout",
         title: "Payout Credited",
         description: p.reason,
         amount: `+₹${p.amount}`,
         time: new Date(p.created_at).toLocaleString(),
         iconName: "Shield",
         color: "text-blue-500"
     }))
  });
});

// Manual claim submission by a worker
router.post('/claim', async (req, res) => {
  const { workerId, claimType, description, location, incidentTime } = req.body;

  if (!workerId || !claimType) {
    return res.status(400).json({ error: 'workerId and claimType are required' });
  }

  // Parametric payout map based on claim type
  const payoutMap = {
    'weather':    { amount: 80,  reason: 'Environmental Disruption: Manual report by worker' },
    'delivery':   { amount: 40,  reason: 'Unlucky Situation: Failed delivery reported by worker' },
    'unsafe':     { amount: 100, reason: 'Unsafe Location: High-risk zone reported by worker' },
    'custom':     { amount: 50,  reason: 'Custom Claim: Reported by worker' },
  };

  const payout = payoutMap[claimType] || payoutMap['custom'];
  const reason = description
    ? `${payout.reason} — "${description}"`
    : payout.reason;

  console.log(`[MANUAL CLAIM] Worker ${workerId} filed a ${claimType} claim. Payout: ₹${payout.amount}`);

  try {
    const { data, error } = await supabase.from('claims').insert([{
      worker_id: workerId,
      amount: payout.amount,
      reason: reason,
      status: 'APPROVED',
      created_at: incidentTime ? new Date(incidentTime) : new Date(),
    }]).select().single();

    if (error) {
      console.error('[MANUAL CLAIM DB ERROR]', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      claimId: 'CLM-' + data.id.split('-')[0].toUpperCase(),
      amount: payout.amount,
      reason: reason,
      status: 'APPROVED',
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'DB error during claim submission' });
  }
});

export default router;

