import { initializeApp } from 'firebase/app'
import {
  initializeAppCheck,
  CustomProvider,
  ReCaptchaEnterpriseProvider,
} from 'firebase/app-check'
import { getAI, GoogleAIBackend } from 'firebase/ai'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)

// App Check. In development the SDK uses a debug token: on first load it prints
// "App Check debug token: ..." in the browser console. Register that token in the
// Firebase console (App Check > Apps > volubly-web > Manage debug tokens).
// The debug flag must be set before initializeAppCheck runs.
if (import.meta.env.DEV) {
  ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true
}

const recaptchaSiteKey: string | undefined = import.meta.env.VITE_RECAPTCHA_SITE_KEY

export const appCheck = initializeAppCheck(app, {
  // With a debug token the provider is never asked for a token, so a placeholder
  // provider is enough for local development. The hosted app needs the reCAPTCHA key.
  provider: recaptchaSiteKey
    ? new ReCaptchaEnterpriseProvider(recaptchaSiteKey)
    : new CustomProvider({
        getToken: () =>
          Promise.reject(new Error('No App Check provider configured (set VITE_RECAPTCHA_SITE_KEY)')),
      }),
  isTokenAutoRefreshEnabled: true,
})

// All AI inference in Volubly goes through Firebase AI Logic (Gemini Developer API backend).
export const ai = getAI(app, { backend: new GoogleAIBackend() })