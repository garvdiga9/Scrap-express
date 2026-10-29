// Customer login is optional: it switches on only once the Firebase project
// settings are present, so the site keeps working before Firebase is set up.
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const clientConfig = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
};

const enabled = Boolean(clientConfig.apiKey && clientConfig.authDomain && clientConfig.projectId);
// Phone OTP needs Firebase's paid Blaze plan, so it stays hidden until the
// project has billing and FIREBASE_PHONE_LOGIN=true is set.
const phoneEnabled = enabled && process.env.FIREBASE_PHONE_LOGIN === 'true';

let auth = null;
if (enabled) {
  // Verifying ID tokens needs only the project ID (Google's public keys are
  // fetched automatically), so no service-account secret is required.
  initializeApp({ projectId: clientConfig.projectId });
  auth = getAuth();
}

async function verifyIdToken(idToken) {
  if (!auth) throw new Error('Customer login is not configured');
  return auth.verifyIdToken(idToken);
}

module.exports = { enabled, phoneEnabled, clientConfig, verifyIdToken };
