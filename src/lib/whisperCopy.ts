/**
 * Every user-facing whisper string lives here, so wording can be reviewed and tested in one place.
 *
 * Rules for this file (checked by tests):
 * - Threads "end". Never "deleted", "erased" or "removed".
 * - No claim of encryption, total privacy or safety. The one true statement is that only the two
 *   people can read a thread through the app.
 * - The three error texts never say why something failed (see whisperErrors.ts).
 */

// Errors: exactly two specific messages, and one generic.
export const TOO_MANY_TEXT = 'You have too many whispers open. End one or wait for one to finish, then try again.'
export const INVITE_EXPIRED_TEXT = 'This invite expired.'
export const GENERIC_ERROR_TEXT = "That didn't work. Check your connection and try again."

// Inbox
export const INBOX_TITLE = 'Whispers'
export const INBOX_EMPTY = 'No whispers right now. Tap a name in a room to invite someone.'
export const INBOX_ERROR = "We couldn't load your whispers. Check your connection and try again."
export const INBOX_LOADING = 'Loading whispers...'
export const SECTION_INVITES = 'Invites for you'
export const SECTION_OPEN = 'Open whispers'
export const SECTION_WAITING = 'Waiting for a reply'

// Buttons and links
export const BTN_ACCEPT = 'Accept'
export const BTN_DECLINE = 'Decline'
export const BTN_DECLINE_BLOCK = 'Decline and block'
export const BTN_CANCEL_INVITE = 'Cancel invite'
export const BTN_INVITE = 'Invite to a whisper'
export const BTN_UNBLOCK = 'Unblock'
export const BTN_END = 'End whisper'
export const BTN_END_BLOCK = 'End and block'
export const BTN_END_CONFIRM = 'End'
export const BTN_KEEP = 'Keep chatting'
export const BTN_RETRY = 'Try again'
export const LINK_BACK_WHISPERS = 'Back to whispers'
export const LINK_BACK_ROOMS = 'Back to rooms'
export const LINK_OPEN_WHISPERS = 'Open whispers'
export const LINK_WHISPERS = 'Whispers'

/** Accessible name of the Home link: "Whispers" or "Whispers, 2 invites". */
export function whispersLinkName(pending: number): string {
  if (pending <= 0) return LINK_WHISPERS
  return `${LINK_WHISPERS}, ${pending} ${pending === 1 ? 'invite' : 'invites'}`
}

// Person sheet
export const SHEET_NOTE = 'Whispers work between people in the same age group. Not every invite can be sent.'
export const SHEET_LOADING = 'One moment...'
export const SHEET_SENDING = 'Sending...'
export const sheetExisting = (name: string, kind: 'open' | 'sent' | 'received'): string =>
  kind === 'open'
    ? `You already have a whisper with ${name}.`
    : kind === 'sent'
      ? `You already invited ${name}.`
      : `${name} already invited you.`
export const sheetBlocked = (name: string): string => `You blocked ${name}.`
export const inviteSent = (name: string): string => `Invite sent. ${name} has 15 minutes to accept.`

// Chat
export const chatNote = (name: string): string =>
  `Only you and ${name} can read this in the app. It ends 1 hour after it was accepted.`
export const waitingFor = (name: string): string => `Waiting for ${name} to reply.`
export const invitedBy = (name: string): string => `${name} invited you to a whisper.`
export const endConfirmTitle = 'End this whisper?'
export const blockResult = (name: string): string => `You blocked ${name}.`
export const WHISPER_ENDED = 'This whisper has ended.'
export const WHISPER_UNAVAILABLE = "This whisper isn't available."
export const ACCOUNT_NOT_ALLOWED = "Whispers aren't available for this account."
export const SEND_CLOSED = 'This whisper has ended, so messages can no longer be sent.'
export const CHAT_EMPTY = 'No messages yet. Say something to get it started.'
export const CHAT_LOADING = 'Loading messages...'
export const countdownLabel = (mmss: string): string => `${mmss} left`
