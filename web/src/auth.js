// ponytail: hardcoded creds, plaintext sessionStorage flag — swap for real backend auth when needed
const ADMIN_USER = 'admin'
const ADMIN_PASS = 'admin123'
const KEY = 'pairdesk_logged_in'

export function login(user, pass) {
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    sessionStorage.setItem(KEY, '1')
    return true
  }
  return false
}

export function logout() {
  sessionStorage.removeItem(KEY)
}

export function isLoggedIn() {
  return sessionStorage.getItem(KEY) === '1'
}
