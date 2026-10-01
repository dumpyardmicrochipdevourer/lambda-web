# lambda-web

The page of lambda and the gateway in front of the services. Plain HTML, CSS and
JavaScript modules: no build step, no framework, nothing loaded from outside.
nginx serves the page and proxies the API:

| path | goes to |
|---|---|
| `/api/auth/*`, `/api/invites`, `/api/users` | lambda-auth |
| `/api/share/*`, `/api/files/*`, `/api/feedback` | lambda-core |
| everything else | `public/` |

## What the page does

**Swap**, no sign-in: drop files or type a text, pick how long to keep it
(15 minutes, an hour, a day), get a code, a QR and a link. The other side opens
`/#CODE` and downloads one file, a zip of all, or reads the text right on the
page. A text is a file named `message.txt`; it is shown as text only if it is
alone, small and really decodes as UTF-8, otherwise it is a normal file.

**My files**, signed in: a quota bar, upload with resume (a dropped connection
continues from what reached the server, re-picking the same file continues a
half-uploaded one), download, delete. Taken names get a suffix.

**Accounts**: sign-in, sign-up by an invite link `/#invite/<code>`, password
change at `/#account`. The access token lives in memory, the refresh token in
`localStorage`; refreshes are serialized across tabs because a refresh token
works only once.

**Admin** (`/#admin`, admins only): invites, people (disable / enable),
feedback inbox. Feedback itself is a sheet open to anyone.

Russian and English, picked by the browser and switchable in the footer.
Light and dark follow the system. Phone and desktop share one layout.

## Files

```
public/index.html     markup of every screen
public/app.css        styles from the design, no inline styles (strict CSP)
public/js/app.js      screens and flows
public/js/api.js      tokens, refresh, uploads
public/js/i18n.js     all strings, ru and en
public/js/qr.js       QR encoder, byte mode, level M, versions 1-10
public/fonts/         Golos Text and JetBrains Mono, OFL
nginx/                gateway config, security headers
e2e/stack.mjs         browser run against a live stack
```

## Run

```sh
docker build -t lambda-web .
docker run -e AUTH_UPSTREAM=auth:8081 -e CORE_UPSTREAM=core:8080 -p 8090:8080 lambda-web
```

Upstreams are resolved through Docker's DNS, so the container is meant to sit in
the same compose project as the services; `lambda-deploy` does that.

End-to-end check against a running stack (Playwright):

```sh
node e2e/stack.mjs http://127.0.0.1:8090 admin '<admin password>' /tmp/shots
```
