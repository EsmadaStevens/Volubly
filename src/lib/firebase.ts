import { initializeApp } from 'firebase/app'
import {
  initializeAppCheck,
  CustomProvider,
  ReCaptchaEnterpriseProvider,
} from 'firebase/app-check'
import { getAI, GoogleAIBackend } from 'firebase/ai'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)

// App Check. In development the SDK uses a debug token registered in the Firebase console.
// The debug flag must be set before initializeAppCheck runs.
if (import.meta.env.DEV) {
  ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true
}

const recaptchaSiteKey: string | undefined = import.meta.env.VITE_RECAPTCHA_SITE_KEY

export const appCheck = initializeAppCheck(app, {
  provider: recaptchaSiteKey
    ? new ReCaptchaEnterpriseProvider(recaptchaSiteKey)
    : new CustomProvider({
        getToken: () =>
          Promise.reject(new Error('No App Check provider configured (set VITE_RECAPTCHA_SITE_KEY)')),
      }),
  isTokenAutoRefreshEnabled: true,
})

// Created after App Check so their requests carry a token.
export const auth = getAuth(app)
export const db = getFirestore(app)

// All AI inference in Volubly goes through Firebase AI Logic (Gemini Developer API backend).
export const ai = getAI(app, { backend: new GoogleAIBackend() })
