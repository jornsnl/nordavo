/** Same answer whether or not the address has an account, so the form cannot be used to find out who has one. */
export const FORGOT_PASSWORD_SENT = (email: string) =>
  `If ${email} has an account, a link to choose a new password is on its way. It works once, within an hour.`;
