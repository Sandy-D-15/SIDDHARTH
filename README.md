# SIDDHARTH

## SiddVerse

SiddVerse is a local social-community demo with a Node.js HTTP server and a SQLite database. Accounts, profiles, posts, likes, comments, follows, saved posts, and notifications are stored in SQLite. Passwords are stored as salted scrypt hashes, and the login session uses an HTTP-only cookie.

## Run locally

1. Install Node.js 22.13 or newer.
2. From this folder, run `npm start`.
3. Open <http://127.0.0.1:3000>.

The database is created automatically at `data/siddverse.sqlite` on the first run. It is intentionally ignored by Git. Stop the server with Ctrl+C; your data remains in the database on the next run.

The server uses Node's built-in `node:sqlite` module, so no additional package installation is needed. Some Node releases print an experimental-feature warning for this module.

## Demo accounts

The first run seeds these accounts. Each uses the password `1234`.

| Username | Password |
| --- | --- |
| `siddhant` | `1234` |
| `priya` | `1234` |
| `rahul` | `1234` |

This prototype binds only to localhost. Do not expose it to the internet or use real passwords.