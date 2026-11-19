# Protocol

Last updated: 2026-11-18

This document is the contract between the browser pages and the Node.js server. It covers the HTTP endpoints used for account handling and the Socket.IO conventions that room and race handling build on. Code that follows a different shape is out of date with this document.

Status: the account part (UC-01 to UC-03) is implemented. The room and race sections are not defined yet; see section 8.

## 1. Conventions

- HTTP endpoints live under `/api`. Pages are files served from `public/`.
- Request bodies are JSON with `Content-Type: application/json`. Form-encoded bodies are accepted as well.
- Every response is JSON, including failures raised by the server itself.
- A successful response is `{"ok": true, ...}`.
- A rejected request is `{"ok": false, "errors": [...]}`.
- Each entry in `errors` is `{"field": ..., "code": ..., "message": ...}`:
  - `field` is the form field to highlight: `username`, `password`, `confirmPassword`, or `null` when the failure is not tied to one field.
  - `code` is stable and meant for branching in code.
  - `message` is English text that can be shown to the player as is.
- A successful account response carries `redirect`, the page to open next.
- A request may report more than one error at once, for example one per empty field. The page shows every entry rather than only the first.

## 2. Sessions

- The session identifier travels in the cookie `connect.sid`. It is `HttpOnly` and `SameSite=Lax`, and it expires after seven days. The cookie carries the identifier only; the state stays on the server.
- One account holds one session at a time. Signing in replaces the identifier recorded for the account, and the earlier session stops working at its next request.
- A session that has been replaced is answered with HTTP 401 and the error code `session_terminated`. The cookie is cleared at the same time. The page should send the player back to the home page.
- The session secret is read from `SESSION_SECRET` in `.env`. A development default is used when the file is absent.

## 3. POST /api/register

Creates an account and signs it in. UC-01.

Request body:

| Field | Type | Rule |
| --- | --- | --- |
| `username` | string | 3 to 16 characters, letters, digits and underscores only, not already taken |
| `password` | string | at least 8 characters, contains at least one letter and one digit |
| `confirmPassword` | string | identical to `password` |

Responses:

| Status | Body | When |
| --- | --- | --- |
| 201 | `{"ok": true, "account": {"username": "..."}, "redirect": "/lobby.html"}` | the account was created and signed in |
| 400 | `{"ok": false, "errors": [...]}` | the input was rejected |
| 409 | `{"ok": false, "errors": [{"field": null, "code": "already_signed_in", ...}]}` | the browser already holds a valid session |

Usernames are compared without regard to case, so `Player1` and `player1` are the same account. The spelling used at registration is kept for display.

Error codes:

| Code | `field` | Meaning |
| --- | --- | --- |
| `missing_username` | `username` | the username is empty |
| `missing_password` | `password` | the password is empty |
| `missing_confirm_password` | `confirmPassword` | the confirmation is empty |
| `invalid_username` | `username` | length or character rule broken |
| `username_taken` | `username` | the name belongs to an existing account |
| `weak_password` | `password` | length or composition rule broken |
| `password_mismatch` | `confirmPassword` | the two passwords differ |

A rejected request never changes the account store.

## 4. POST /api/login

Signs an existing account in. UC-02.

Request body:

| Field | Type | Rule |
| --- | --- | --- |
| `username` | string | the account name |
| `password` | string | the account password |

Responses:

| Status | Body | When |
| --- | --- | --- |
| 200 | `{"ok": true, "account": {"username": "..."}, "redirect": "/lobby.html"}` | the credentials matched |
| 200 | same body plus `"alreadySignedIn": true` | a valid session already existed, so the form was skipped (UC-02 A3) |
| 400 | `{"ok": false, "errors": [...]}` | the input was rejected |

Error codes:

| Code | `field` | Meaning |
| --- | --- | --- |
| `missing_username` | `username` | the username is empty |
| `missing_password` | `password` | the password is empty |
| `invalid_credentials` | `null` | the account does not exist or the password is wrong; both cases give this one message |

Signing in ends any session the account held elsewhere; see section 2.

## 5. POST /api/logout

Ends the current session. UC-03. No request body.

Response, HTTP 200:

```json
{ "ok": true, "signedIn": false, "redirect": "/" }
```

The session is destroyed, the account forgets its recorded session identifier, the cookie is cleared and every socket of the account is closed. Calling it without a session is harmless and answers the same way. The only exception is a session that was replaced elsewhere: that request is answered with 401 `session_terminated` (section 2) and the session is already gone.

Removing the player from a room is not implemented yet, because rooms do not exist; see section 8.

## 6. GET /api/session

Tells the page who is signed in. Use it on load to decide between the lobby and the sign-in form (UC-02 A3). No request body.

Signed in:

```json
{ "ok": true, "signedIn": true, "account": { "username": "player1" } }
```

Not signed in:

```json
{ "ok": true, "signedIn": false, "account": null }
```

A session that has been replaced elsewhere is not reported here as signed in; such a request is answered with 401 `session_terminated` as described in section 2.

## 7. Socket.IO

- The client connects to the same origin the page was served from. Engine.IO version 4, so `socket.io-client` 4.x.
- The handshake reuses the session cookie, so the server knows the account without the client sending any name. Nothing in a client payload is trusted as an identity.
- A handshake without a valid session is refused. `connect_error` reaches the client with the message `not signed in`. The page should treat that as "signed out" and go back to the home page.
- After a successful handshake, the server holds the account of the socket. When the account signs out, its sockets are closed by the server.

Not defined yet: event names, payloads and broadcast rates for room and race handling. They are agreed with the owners of the racing and results pages and recorded here before either side implements them.

## 8. Not implemented yet

The following parts of the game have no endpoint or event yet:

- Room creation and joining: room code, member list, ready flags.
- Race start: three-second countdown, shared start timestamp.
- Race loop: input uplink, server tick, snapshots, timer, finish.
- Cheat toggle and its broadcast.
- Results payload.
- Removing a player from a room when the account signs out or is signed in elsewhere.
