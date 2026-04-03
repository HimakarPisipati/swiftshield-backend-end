import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;

/**
 * Sends a transactional email using Brevo API
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} htmlContent - Email body in HTML
 */
export const sendEmail = async (to, subject, htmlContent) => {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
    console.error('[EMAIL ERROR] Brevo credentials missing in .env');
    return { success: false, error: 'Email service misconfigured' };
  }

  const url = 'https://api.brevo.com/v3/smtp/email';
  
  const data = {
    sender: { email: BREVO_SENDER_EMAIL, name: 'SwiftShield Support' },
    to: [{ email: to }],
    subject: subject,
    htmlContent: htmlContent
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[EMAIL SUCCESS] OTP sent to ${to}:`, response.data.messageId);
    return { success: true, messageId: response.data.messageId };
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error('[EMAIL ERROR] Brevo API failed:', errorDetails);
    return { success: false, error: errorDetails };
  }
};

/**
 * Sends a verification OTP to a user
 * @param {string} to - Recipient email
 * @param {string} otp - The 6-digit code
 * @param {string} purpose - 'Registration' or 'Password Reset'
 */
export const sendOtpEmail = async (to, otp, purpose = 'Registration') => {
  const subject = `[SwiftShield] Your ${purpose} Verification Code`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #f9fafb;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #1E3A8A; margin: 0;">SwiftShield</h1>
        <p style="color: #6B7280; margin: 4px 0 0;">Secure Parametric Insurance</p>
      </div>
      <div style="background-color: white; padding: 32px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <h2 style="font-size: 20px; font-weight: bold; color: #111827; margin-bottom: 16px;">Verify your email</h2>
        <p style="color: #4B5563; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">
          Use the following code to complete your ${purpose.toLowerCase()}. This code is valid for 10 minutes.
        </p>
        <div style="background-color: #F3F4F6; padding: 16px; border-radius: 8px; text-align: center;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1E3A8A;">${otp}</span>
        </div>
        <p style="color: #9CA3AF; font-size: 14px; margin-top: 24px;">
          If you didn't request this, please ignore this email or contact support if you have concerns.
        </p>
      </div>
      <div style="text-align: center; margin-top: 24px; color: #9CA3AF; font-size: 12px;">
        &copy; 2026 SwiftShield Inc. All rights reserved.
      </div>
    </div>
  `;
  return sendEmail(to, subject, htmlContent);
};
