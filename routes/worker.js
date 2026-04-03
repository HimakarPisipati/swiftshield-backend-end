import express from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../config/supabase.js';
import { sendOtpEmail } from '../utils/emailService.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { full_name, email, phone_number, password, plan, upi_id, platform, otp } = req.body;

  console.log("[REGISTER] Incoming request:", { ...req.body, password: "****" });

  if (!full_name || !email || !password || !otp) {
    return res.status(400).json({ error: "Missing required fields (including OTP)" });
  }

  try {
    // 1. Verify OTP
    const { data: otpRecord, error: otpError } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email)
      .eq('code', otp)
      .eq('purpose', 'registration')
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpRecord) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    // 2. Hash the password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 2. Insert into Supabase
    const { data: worker, error } = await supabase
      .from('workers')
      .insert([{
        full_name,
        email,
        phone_number,
        password_hash,
        vehicle_type: 'Unknown',
        active_plan: plan || 'Standard',
        upi_id,
        platform,
        risk_score: 10 // Start with default baseline
      }])
      .select()
      .single();

    if (error) {
      console.error("[REGISTER DB ERROR]", error);
      if (error.code === '23505') { // Postgres unique violation (for email)
        return res.status(409).json({ error: "Email already registered" });
      }
      return res.status(500).json({ error: error.message });
    }

    // 4. Mark OTP as used
    await supabase.from('otp_codes').update({ verified: true }).eq('id', otpRecord.id);

    console.log("[REGISTER SUCCESS] New worker ID:", worker.id);

    // 3. Return the new worker ID
    res.json({ success: true, worker: { id: worker.id } });

  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ error: "Server error during registration" });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  console.log("[LOGIN] Attempt for email:", email);

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // 1. Find user by email
    const { data: worker, error } = await supabase
      .from('workers')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !worker) {
      console.log("[LOGIN FAIL] User not found:", email);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // 2. Compare passwords
    const isActive = await bcrypt.compare(password, worker.password_hash);
    if (!isActive) {
      console.log("[LOGIN FAIL] Password mismatch for:", email);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    console.log("[LOGIN SUCCESS] Worker ID:", worker.id);

    // 3. Return the worker ID
    res.json({ 
      success: true, 
      worker: { 
        id: worker.id,
        name: worker.full_name
      } 
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

router.get('/profile/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { data: worker, error } = await supabase
      .from('workers')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !worker) {
      return res.status(404).json({ error: "Worker not found" });
    }

    res.json({
      success: true,
      worker: {
        id: worker.id,
        name: worker.full_name,
        email: worker.email,
        phone_number: worker.phone_number,
        upi_id: worker.upi_id,
        activePlan: worker.active_plan,
        riskScore: worker.risk_score,
        weeklyPremium: worker.active_plan === 'Basic' ? 199 : (worker.active_plan === 'Premium' ? 699 : 399)
      }
    });

  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ error: "Server error during profile fetch" });
  }
});

// Update Profile
router.put('/profile/:userId', async (req, res) => {
  const { userId } = req.params;
  const { full_name, email, phone_number, upi_id } = req.body;

  try {
    const { data, error } = await supabase
      .from('workers')
      .update({ full_name, email, phone_number, upi_id })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error("[PROFILE UPDATE ERROR]", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, worker: data });
  } catch (err) {
    console.error("Profile Update Error:", err);
    res.status(500).json({ error: "Server error during profile update" });
  }
});

// Change Password
router.put('/password/:userId', async (req, res) => {
  const { userId } = req.params;
  const { currentPassword, newPassword } = req.body;

  try {
    // 1. Get current password hash
    const { data: worker, error } = await supabase
      .from('workers')
      .select('password_hash')
      .eq('id', userId)
      .single();

    if (error || !worker) {
      return res.status(404).json({ error: "Worker not found" });
    }

    // 2. Verify current password
    const isMatch = await bcrypt.compare(currentPassword, worker.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    // 3. Hash new password and update
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    const { error: updateError } = await supabase
      .from('workers')
      .update({ password_hash: newPasswordHash })
      .eq('id', userId);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Password Update Error:", err);
    res.status(500).json({ error: "Server error during password change" });
  }
});

// Delete Account
router.delete('/account/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const { error } = await supabase
      .from('workers')
      .delete()
      .eq('id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, message: "Account deleted successfully" });
  } catch (err) {
    console.error("Account Deletion Error:", err);
    res.status(500).json({ error: "Server error during account deletion" });
  }
});

// --- OTP & Password Recovery Routes ---

// Send OTP
router.post('/send-otp', async (req, res) => {
  console.log("[OTP] Received request to send OTP:", req.body);
  const { email, purpose } = req.body; // purpose: 'registration' or 'forgot_password'
  
  if (!email || !purpose) {
    return res.status(400).json({ error: "Email and purpose are required" });
  }

  // If purpose is registration, check if email already exists
  if (purpose === 'registration') {
    const { data: existingUser } = await supabase.from('workers').select('id').eq('email', email).single();
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

  try {
    // 1. Store in DB
    const { error: dbError } = await supabase
      .from('otp_codes')
      .insert([{ email, code: otp, purpose, expires_at: expiresAt }]);

    if (dbError) throw dbError;

    // 2. Send Email
    const emailResult = await sendOtpEmail(email, otp, purpose === 'registration' ? 'Registration' : 'Password Reset');
    
    if (!emailResult.success) {
      return res.status(500).json({ error: "Failed to send email. Please try again later." });
    }

    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    console.error("OTP Error:", err);
    res.status(500).json({ error: "Server error during OTP generation" });
  }
});

// Verify OTP (For Forgot Password UI)
router.post('/verify-otp', async (req, res) => {
  const { email, code, purpose } = req.body;

  try {
    const { data: otpRecord, error: otpError } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .eq('purpose', purpose)
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (otpError || !otpRecord) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    res.json({ success: true, message: "OTP verified" });
  } catch (err) {
    res.status(500).json({ error: "Verification failed" });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;

  try {
    // 1. Verify OTP first (must be 'forgot_password' purpose)
    const { data: otpRecord, error: otpError } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .eq('purpose', 'forgot_password')
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (otpError || !otpRecord) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    // 2. Hash new password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(newPassword, salt);

    // 3. Update User
    const { error: updateError } = await supabase
      .from('workers')
      .update({ password_hash: password_hash })
      .eq('email', email);

    if (updateError) throw updateError;

    // 4. Mark OTP as used
    await supabase.from('otp_codes').update({ verified: true }).eq('id', otpRecord.id);

    res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
