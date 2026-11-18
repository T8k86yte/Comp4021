'use strict';

// Input rules taken from the UC-01 specification, basic flow step 5 and the
// alternative flows A1 to A5. Every failure carries its own message so the
// registration page can show it next to the offending field.

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 16;
const USERNAME_ALLOWED = /^[A-Za-z0-9_]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_DIGIT = /[0-9]/;

const MESSAGES = {
  missingUsername: 'Username is required.',
  missingPassword: 'Password is required.',
  missingConfirmPassword: 'Password confirmation is required.',
  invalidUsername: `Username must be ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters long and may contain letters, digits and underscores only.`,
  usernameTaken: 'That username is already taken. Please choose another one.',
  weakPassword: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long and contain both letters and digits.`,
  passwordMismatch: 'The two passwords do not match.',
};

// The submitted values live in the request body, so they may be missing or not
// strings at all. Everything is reduced to a trimmed string first.
function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function fail(field, code, message) {
  return { field, code, message };
}

/**
 * Validates a registration form.
 *
 * @param {object} input - raw username, password and confirmPassword.
 * @param {object} [options]
 * @param {(username: string) => boolean} [options.isUsernameTaken] - uniqueness check.
 * @returns {{ valid: boolean, username: string, errors: Array<{field: string|null, code: string, message: string}> }}
 */
function validateRegistration(input, options = {}) {
  const isUsernameTaken = options.isUsernameTaken || (() => false);
  const username = toText(input && input.username);
  const password = typeof (input && input.password) === 'string' ? input.password : '';
  const confirmPassword = typeof (input && input.confirmPassword) === 'string' ? input.confirmPassword : '';
  const errors = [];

  // A1: name each empty field instead of one combined complaint.
  if (!username) {
    errors.push(fail('username', 'missing_username', MESSAGES.missingUsername));
  }
  if (!password) {
    errors.push(fail('password', 'missing_password', MESSAGES.missingPassword));
  }
  if (!confirmPassword) {
    errors.push(fail('confirmPassword', 'missing_confirm_password', MESSAGES.missingConfirmPassword));
  }

  // A2: length and character set.
  if (username && (username.length < USERNAME_MIN_LENGTH
    || username.length > USERNAME_MAX_LENGTH
    || !USERNAME_ALLOWED.test(username))) {
    errors.push(fail('username', 'invalid_username', MESSAGES.invalidUsername));
  }

  // A3: uniqueness.
  if (username && !errors.some((error) => error.code === 'invalid_username')
    && isUsernameTaken(username)) {
    errors.push(fail('username', 'username_taken', MESSAGES.usernameTaken));
  }

  // A4: length and composition. Trimming is deliberately skipped here, because
  // spaces are a legitimate way to pad a weak password.
  if (password && (password.length < PASSWORD_MIN_LENGTH
    || !PASSWORD_HAS_LETTER.test(password)
    || !PASSWORD_HAS_DIGIT.test(password))) {
    errors.push(fail('password', 'weak_password', MESSAGES.weakPassword));
  }

  // A5: the two entries must match.
  if (password && confirmPassword && password !== confirmPassword) {
    errors.push(fail('confirmPassword', 'password_mismatch', MESSAGES.passwordMismatch));
  }

  return {
    valid: errors.length === 0,
    username,
    errors,
  };
}

module.exports = {
  MESSAGES,
  validateRegistration,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
};
