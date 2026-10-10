# Client installation guide

Follow this top to bottom on the client's PC. Every command can be copied as is. Allow about **45 minutes**, plus Google's setup the first time ever (about 15 minutes — and once you have done it, every later client takes 2 minutes, see [Part 8](#8-backups-to-google-drive)).

Commands are for **PowerShell** unless a different shell is named. `C:\POS` is used as the install folder; any path without spaces works.

---

## Quick checklist

Tick these off in order. Each line points to the part that explains it.

- [ ] *(On your own PC, before leaving)* commit and push, collect the tokens — [Part 0](#0-before-you-go-to-the-client-on-your-own-pc)
- [ ] Install Node.js, PostgreSQL, Git and Chrome — [Part 1](#1-install-the-software)
- [ ] `git clone` the project to `C:\POS`, run `npm install` — [Part 2](#2-put-the-project-on-the-pc)
- [ ] Create the database and the `.env` file — [Part 3](#3-database-and-environment-file)
- [ ] `prisma migrate deploy`, seed, build — [Part 4](#4-create-the-tables-and-first-users)
- [ ] First start, log in, change the default passwords — [Part 5](#5-first-start-and-first-login)
- [ ] Start automatically when Windows starts — [Part 6](#6-start-automatically-with-windows)
- [ ] Local backup folder + daily schedule — [Part 7](#7-backups-to-the-local-drive-and-the-schedule)
- [ ] Google Drive connected — [Part 8](#8-backups-to-google-drive)
- [ ] Receipt printer, no print dialog — [Part 9](#9-receipt-printer)
- [ ] Run the final checklist — [Part 10](#10-final-checklist-before-you-leave)
- [ ] Remote support access with ngrok (optional) — [Part 11](#11-remote-support-access-with-ngrok)

---

## 0. Before you go to the client (on your own PC)

The client PC gets the project with `git clone`, so **anything you have not committed and pushed is not on it** — launcher scripts, the backup feature and this guide included.

1. **Commit and push everything:**

   ```powershell
   cd D:\projects\pos
   git status      # nothing should be left untracked or unstaged
   git ls-files start-pos.vbs start-pos.bat start-ngrok.bat stop-pos.bat CLIENT-SETUP.md   # all five must be listed
   git add -A
   git commit -m "Describe what changed"
   git push
   ```

2. **Make sure the client PC can reach the repository.** For a private repo, Git asks you to sign in on the first `clone` — use a personal access token as the password (or set up a deploy key). No internet or no Git there? Copy the project folder from a USB stick instead, **without** `node_modules`, `.next` and `.env`.
3. **Collect these and keep them in your password manager** — you need them on site:

   | What | Where it comes from |
   | --- | --- |
   | ngrok **authtoken** and **domain** for this client | a free ngrok account made for the client ([11.1](#111-account-and-domain-on-your-side-per-client)) |
   | The Google account **you** will sign in to ngrok with | goes into `ngrok-policy.yml` ([11.3](#113-lock-it-down-first--important)) |
   | Google OAuth **Client ID** and **Client Secret** | created once, reusable on every client ([8.1](#81-one-time-google-setup)) |
   | The client's **Google account** for Drive backups | ask the client; they sign in once ([8.2](#82-connect-the-clients-drive-on-the-client-pc)) |
   | A **PostgreSQL password** to set | you choose it ([Part 1](#1-install-the-software)) |

4. **Download the installers** (Node.js LTS, PostgreSQL, Git, Chrome, ngrok) onto a USB stick in case the client's internet is slow.
5. `.env` is **git-ignored on purpose** (it holds secrets), so each client gets their own, written in Part 3.

---

## 1. Install the software

| Software | Notes |
| --- | --- |
| **Node.js** | Install the current **LTS** from nodejs.org, tick "Add to PATH". The project was built on Node 24. Check with `node -v` and `npm -v`. |
| **PostgreSQL** | Version 14 or newer from postgresql.org. Remember the `postgres` password you set — you need it in Part 3. Leave "run as a service" on so it starts with Windows. |
| **Google Chrome** | The POS is used in Chrome (printing and the installable app depend on it). |
| **Git** | From git-scm.com (default options). Needed to `git clone` the project and to update it later with `git pull`. Without it you must copy the folder from a USB stick. |

Set the PC's **time zone to Pakistan (UTC+5)**: Settings → Time & language → Date & time. Scheduled backups run on the PC's clock.

Set **Power & sleep → Sleep: Never** (when plugged in). A sleeping PC does not run backups on time.

---

## 2. Put the project on the PC

```powershell
cd C:\
git clone <your-repo-url> POS
cd C:\POS
npm install
```

- `git clone` creates `C:\POS` itself. For a private repository a sign-in window appears the first time — use your Git account and a personal access token.
- `npm install` takes a few minutes, needs internet, and also generates the Prisma client.
- No Git? Copy the project folder (without `node_modules`, `.next` and `.env`) to `C:\POS` and run `npm install`.
- Later updates are `git pull` — see [Updating a client later](#updating-a-client-later).

---

## 3. Database and environment file

### 3.1 Create the empty database

Open **pgAdmin** (installed with PostgreSQL) → right-click *Databases* → *Create → Database* → name it `clothposdb`.

Or from PowerShell (adjust the path to your PostgreSQL version):

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE clothposdb;"
```

### 3.2 Create `C:\POS\.env`

Copy `.env.example` to `.env` and set exactly these values:

```ini
DB_PROVIDER="local"

DATABASE_URL="postgresql://postgres:YOUR_PG_PASSWORD@localhost:5432/clothposdb"
DIRECT_URL="postgresql://postgres:YOUR_PG_PASSWORD@localhost:5432/clothposdb"

NEXTAUTH_SECRET="PASTE_A_RANDOM_SECRET_HERE"
NEXTAUTH_URL="http://localhost:3000"
AUTH_TRUST_HOST=true

ENABLE_TEST_DATA_TOOLS="false"
```

- **Generate the secret** (use a new one for every client):
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- If the PostgreSQL password contains `@ : / # ?` or `%`, URL-encode it (`@` → `%40`), or choose a simpler password.
- **Keep `ENABLE_TEST_DATA_TOOLS="false"`** on a client machine. `true` shows a tool that wipes sales data.
- **Do not create a `.env.local`** for a local install. If one exists, it overrides `.env` for the running app (that is how the dev machine points at Supabase), and backups and migrations may then talk to different databases.

---

## 4. Create the tables and first users

```powershell
cd C:\POS
npx prisma migrate deploy
npm run db:seed
npm run build
```

- `migrate deploy` must end with *"All migrations have been successfully applied"*.
- `db:seed` creates the organization, a branch, three users and a few **sample items**, plus the default customer "Walking Customer" (ID 1001). The default logins are printed at the end:

  | Role | Email | Password |
  | --- | --- | --- |
  | Super Admin | `admin@sidheysheikhcloth.com` | `admin123` |
  | Manager | `manager@sidheysheikhcloth.com` | `manager123` |
  | Cashier | `cashier@sidheysheikhcloth.com` | `cashier123` |

  These are **well-known defaults — change them in Part 5.**
- `build` takes a few minutes. After any code or `.env` change you must run `npm run build` again; `npm start` runs the *built* copy, not your edits.
- **Two things the build needs:** PostgreSQL must be **running** (some pages read the database while being built — with the database down the build stops early and `npm start` then crashes with *"prerender-manifest.json not found"*), and the PC must be **online** (the Google fonts are downloaded during the build; I have not tested building offline). After it has been built, the POS itself needs no internet.

---

## 5. First start and first login

```powershell
npm start
```

Open **http://localhost:3000** in Chrome (always this exact address — Part 8 depends on it) and sign in as the Super Admin.

Then, in the app:

1. **Settings → Users:** change all three passwords, and change the email addresses to the client's. Delete the users the client won't use.
2. **Settings → Store:** set the store name, address, city, phone, mobile.
3. **Settings → Receipt:** set the footer terms and the font size (12 is the default).
4. **Items:** delete or edit the sample items from the seed.
5. Optional: upload the client's logo and icon under **Settings → Store → Branding** (also shown on the PWA tab).

Stop the server with `Ctrl+C` for now; Part 6 makes it start by itself.

---

## 6. Start automatically with Windows

Goal: when Windows starts and the client logs in, the POS server and (if installed) the ngrok support tunnel start **by themselves, hidden**, and a short message shows the addresses. The POS runs fully on `http://localhost:3000` with **no internet**; ngrok is only for your remote support and never holds the POS up.

PostgreSQL must start with Windows too: as a Windows service on the client PC (Part 1 — leave "run as a service" on). On a developer PC that runs PostgreSQL through DBngin, set DBngin to start at login and start the database automatically. The launcher waits up to 60 seconds for the database before starting the server.

### 6.1 The launcher files (already in the project folder — no editing needed)

They work from whichever folder the project is in, so nothing contains a hard-coded path.

| File | What it does |
| --- | --- |
| `start-pos.vbs` | What the Startup shortcut runs. Starts everything **with no windows**, waits until the POS answers, then shows a message with the local address (and the ngrok address when the tunnel is up). |
| `start-pos.bat` | Waits for PostgreSQL, starts the ngrok tunnel in the background, then the POS server on port 3000. Does nothing if the POS is already running, so starting it twice is harmless. |
| `start-ngrok.bat` | Keeps the tunnel up: if ngrok exits (no internet at boot, network drop) it tries again every 30 seconds. |
| `stop-pos.bat` | Stops the POS server and the tunnel. |

Logs (created in the project folder, ignored by git): **`pos-server.log`** (server output), **`ngrok.log`** (tunnel warnings and errors).

Settings are at the top of `start-pos.bat`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | The POS port. Keep 3000: the PWA, `NEXTAUTH_URL` notes and the Google redirect address all assume it. |
| `DB_PORT` | `5432` | The port the launcher waits for before starting the server. |
| `USE_NGROK` | `1` | `0` = POS only (use this on a client where ngrok isn't set up yet). |
| `NGROK_URL` | empty | Empty = the ngrok account's own domain. Or set `https://YOUR-DOMAIN.ngrok-free.dev`. |

> `NEXTAUTH_URL` must stay **unset** in `.env` (Part 3). With it set, the server redirects every request to that address and the client's localhost stops working.

### 6.2 Run at every Windows login

In **PowerShell** (change `$dir` if the project is elsewhere):

```powershell
$dir = 'C:\POS'
$w = New-Object -ComObject WScript.Shell
$s = $w.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\POS.lnk")
$s.TargetPath = 'wscript.exe'
$s.Arguments = "`"$dir\start-pos.vbs`""
$s.WorkingDirectory = $dir
$s.Save()
```

Or by hand: `Win + R` → `shell:startup` → create a shortcut to `start-pos.vbs` in that folder.

The shortcut runs when the user **logs in**, not before. To have the shop PC come up without anybody typing a password after a power cut, enable Windows auto-login (6.4).

### 6.3 Open the installed POS app automatically (optional)

1. In Chrome, open **`http://localhost:3000`** (never the ngrok address) and click the **Install** icon in the address bar (or the menu → *Cast, save and share → Install page as app*). This needs the production server (`npm start`), not `npm run dev`.
2. Find the shortcut Chrome created, usually `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Chrome Apps\<name>.lnk`.
3. Put that full path into `start-pos.vbs`, on the line `Const APP_SHORTCUT = ""`.

The app then opens by itself once the server is ready.

### 6.4 Optional: sign in to Windows automatically

Run `netplwiz`, untick *"Users must enter a user name and password"*, enter the password once. Only do this if the client agrees — anyone who switches the PC on gets into Windows.

### 6.5 Test it

1. Reboot, log in. Within about 20 seconds a message appears: **"POS is running. Local: http://localhost:3000"** (plus a *Support:* line if ngrok is up).
2. Open `http://localhost:3000` — the login page appears. Turn off Wi-Fi / pull the network cable and reload: it must still work.
3. If the message says **"The POS did not start"**: read `pos-server.log`, and check PostgreSQL is running and that you ran `npm run build` while it was running (Part 4).

### 6.6 Stop and start by hand

```powershell
C:\POS\stop-pos.bat            # stops the POS server and the tunnel
wscript C:\POS\start-pos.vbs   # starts them again, hidden
```

---

## 7. Backups to the local drive and the schedule

Do this **before** the client starts entering real data.

1. Sign in as **Super Admin** (only Super Admin can change backup settings).
2. **Settings → Backup → Automatic & Cloud Backup → Schedule.**
3. **Local backup folder:** put it on a **different drive or a USB/external disk** than Windows if there is one, e.g. `E:\POS_Backups`. Click **Test folder** — it must say the folder is ready.
4. **Backup formats:** leave **JSON** ticked — it is the only format the app can restore from. Tick SQL and/or Excel only if the client wants those copies too.
5. Tick **Run backups automatically**; choose **Every day** and a time when the shop is closed or quiet (the default 23:30 assumes the PC is still on then).
6. **Send scheduled backups to:** tick *Local folder*. (Tick *Google Drive* after Part 8.)
7. **Keep local backups for:** 30 days is a good default.
8. Click **Save schedule**. The *Windows scheduled task* line should now say **Active** with the next run time.

### Test it once

- Click **Save to local folder** → a file `pos-backup-YYYY-MM-DD_HHmm.json.gz` appears in the folder and a row appears under *Recent backups*.
- Prove the scheduled task itself works: open **Task Scheduler**, find **`POS_Database_Backup`**, right-click → **Run**. Then open `C:\POS\backup.log` — the last lines should say `saved pos-backup-…`, and a new file should be in the folder.

How the schedule works (so you can explain it to the client):

- Windows Task Scheduler runs `scripts\run-backup.cmd`, which runs the backup **directly against the database — the POS server does not have to be running**.
- It runs as the **logged-in Windows user** and only while that user is logged in. If the PC was off at the set time, it runs when the PC next starts.
- Everything it does is appended to `C:\POS\backup.log`, and each run appears in the History table.

---

## 8. Backups to Google Drive

### 8.1 One-time Google setup

> **Save time across clients:** you only need to do 8.1 **once, ever**. Every install uses `http://localhost:3000`, so the **same Client ID and Secret can be pasted into every client PC**. Each client then only does 8.2 with *their own* Google account, and their backups go to *their own* Drive. Trade-offs: the secret lives on each client PC (if one leaks, rotate it in Google and update the others), and Google limits how many accounts may use an unverified app — if you ever reach it, ask Google to verify the app. If you prefer separate projects per client, repeat 8.1 for each.

1. Go to **https://console.cloud.google.com** and sign in with the Google account that will *own the project* (yours, or the client's).
2. Top bar → project picker → **New project** → name `pos-backup` → **Create**. Make sure it is the selected project.
3. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
4. **APIs & Services → OAuth consent screen** (may appear as *Google Auth Platform*):
   - **Get started** → App name `pos-backup`, User support email = your email.
   - Audience: **External**. Contact email = your email. Agree, **Create**.
5. **Publish the app — do not skip this.** Open **Audience** (or the consent screen's *Publishing status*) → **Publish app** → confirm, so the status says **In production**.
   - Left in *Testing*, Google **disconnects the app every 7 days** and backups to Drive silently stop. Testing mode also blocks any account that is not on the "test users" list (`Error 403: access_denied`).
   - You do not need Google's verification for this app, because it asks only for the `drive.file` permission (access to files it creates itself).
6. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application** (not "Desktop app" — that type cannot take our redirect address).
   - Name: `POS Web`.
   - **Authorized redirect URIs → Add URI**, paste exactly:
     ```
     http://localhost:3000/api/settings/backup/google/callback
     ```
     No trailing slash, `http` not `https`, port `3000`.
   - **Create**. Copy the **Client ID** and **Client secret** into a password manager. (Don't leave the downloaded `client_secret_….json` file inside the project folder.)
7. Changes can take a few minutes (rarely longer) before Google accepts them.

### 8.2 Connect the client's Drive (on the client PC)

1. Open the POS at **http://localhost:3000** — *exactly* this address, not the PC's name or an IP address — signed in as Super Admin.
2. **Settings → Backup → Google Drive.** Paste the **Client ID** and **Client Secret**, click **Save credentials**.
3. Click **Connect Google Drive**. Google's page opens.
4. Choose the **client's Google account** (the one whose Drive should hold the backups) and approve.
   - If you see **"Google hasn't verified this app"**: click **Advanced → Go to pos-backup (unsafe)** → continue. It is your own app.
5. You return to Settings and the card shows **Connected as client@gmail.com**.
6. Click **Upload to Google Drive** — a folder named `POS_Backups` appears in the client's Drive with the file inside. (Folder name and retention are in the Schedule section: keep Drive backups 60 days is a good default.)
7. In the Schedule section, tick **Google Drive** under *Send scheduled backups to* and click **Save schedule**.

The sign-in is needed **only this once**. After that the app uses a stored token and uploads by itself every night.

> The app can only see files it created itself. A folder the client made by hand with the same name is **not** used; the app makes its own.

---

## 9. Receipt printer

1. Install the thermal printer's Windows driver and make it the **default printer** (Settings → Bluetooth & devices → Printers & scanners → the printer → *Set as default*; turn off "Let Windows manage my default printer").
2. Set the printer's paper to **80 mm** in its driver preferences.
3. Make a test sale and print. With the `--kiosk-printing` start from Part 6 it prints immediately with no dialog; without that flag Chrome shows the print preview first.
4. If the text is too small or too big: **Settings → Receipt → Receipt Font Size** (presets 10–20, default 12). Everything on the slip scales with it.
5. Printing to PDF (for testing) while kiosk printing is on: change the Windows default printer to *Microsoft Print to PDF* first, or open the POS in a normal Chrome window.

---

## 10. Final checklist before you leave

**System**
- [ ] `node -v` works; PostgreSQL service is *Running* (`services.msc`)
- [ ] Reboot the PC → after login the POS opens by itself within ~15 s
- [ ] The client can sign in with **their own** changed passwords; default `…@sidheysheikhcloth.com` users removed or changed
- [ ] `ENABLE_TEST_DATA_TOOLS="false"` in `C:\POS\.env` (there is no *Clear Data* tab in Settings)
- [ ] No `.env.local` file exists; no `client_secret_*.json` left in `C:\POS`

**Data**
- [ ] Store name, address, phone, receipt footer set; sample items deleted
- [ ] A test sale prints correctly on the thermal printer; test sale voided/removed

**Backups**
- [ ] Settings → Backup shows *Windows scheduled task: **Active*** with a next-run time
- [ ] **Save to local folder** produced a file in the backup folder
- [ ] Task Scheduler → `POS_Database_Backup` → **Run** → `backup.log` shows `saved …` and a new file appeared
- [ ] Google Drive shows **Connected as …** and **Upload to Google Drive** put a file in the client's `POS_Backups` folder
- [ ] **Restore test (important):** Settings → Backup → Restore → *Local backup folder* → pick the newest file → read the summary → type `RESTORE` → restore. The app must still work and the safety copy `pos-prerestore-….json.gz` should now be in the folder. (Do this on day one while the data is still just a test.)
- [ ] Told the client: backups run **only while the Windows user is logged in**; keep the PC on at the scheduled time

**Remote support (if set up)**
- [ ] `ngrok config check` passes and `ngrok service start` is running (or the by-hand command works)
- [ ] From **your** PC: `https://YOUR-DOMAIN.ngrok-free.dev` → Google sign-in → POS login works; a stranger's Google account gets 403
- [ ] The client's own `http://localhost:3000` still works at the same time

**Hand-over notes to leave with the client**
- The PostgreSQL `postgres` password, the POS admin login, and the Google account used for Drive
- Backup folder location and Drive folder name
- Your phone number

---

## 11. Remote support access with ngrok

Goal: the client keeps working at **`http://localhost:3000`** as always, while **you** open the same POS from your own PC at an `https://….ngrok-free.dev` address and sign in as admin to help.

### How both can work at once

ngrok is a small program on the **client PC**. It makes an *outbound* connection to ngrok's servers and hands you a public address; anything arriving there is passed to `localhost:3000` **on the client PC**. So:

```
Client PC browser ──► http://localhost:3000 ──────────┐
                                                      ▼
                                          POS server (client PC, port 3000) ──► PostgreSQL
                                                      ▲
Your PC browser ──► https://xyz.ngrok-free.dev ─► ngrok cloud ─► ngrok agent (client PC)
```

There is **one** server and **one** database. The client never touches ngrok. Because the two addresses are different websites to the browser, you each get your **own login session** — signing out on your side doesn't sign the client out. No firewall or router changes are needed, since the connection is outbound. `AUTH_TRUST_HOST=true` in `.env` (Part 3) is what lets the app accept requests that arrive under the ngrok address.

### 11.1 Account and domain (on your side, per client)

1. Create a free account at **ngrok.com** (use a support mailbox you control, e.g. `support+clientname@yourcompany.com`).
2. In the dashboard open **Domains** — the free plan gives each account **one** auto-assigned `…ngrok-free.dev` domain that stays the same. Note it down.
3. Copy the account's **Authtoken** (dashboard → *Your Authtoken*).

> **One free account per client.** Extra reserved domains need a paid plan, so use one free account (hence one stable domain) for each client — or pay for one account with several domains. Free-plan limits when this was written: **1 GB transfer and 20,000 requests per month** — plenty for occasional support, not for daily use through the tunnel. Visitors see ngrok's "You are about to visit…" page once per browser (click **Visit Site**; it remembers for 7 days). Check ngrok's current pricing page, these limits change.

### 11.2 Install ngrok on the client PC

1. Download from **https://ngrok.com/download** (Windows) and unzip `ngrok.exe` to `C:\ngrok\`, or install with `winget install ngrok`.
2. Save the account's authtoken. **Normal case — the launcher from Part 6** (`ngrok.exe` on the PATH, e.g. installed with winget):

   ```powershell
   ngrok config add-authtoken PASTE_AUTHTOKEN
   ```

   This writes the default ngrok config (`%LocalAppData%\ngrok\ngrok.yml`), which `start-ngrok.bat` uses. Nothing is stored in the project folder.

   **Only if you will run it as a Windows service (11.5, alternative)** or by hand with the commands in 11.4, keep a separate config **outside the project folder**:

   ```powershell
   mkdir C:\ngrok
   C:\ngrok\ngrok.exe config add-authtoken PASTE_AUTHTOKEN --config C:\ngrok\ngrok.yml
   ```

### 11.3 Lock it down first — important

An ngrok address is **public**: anyone who learns it can reach the client's POS login page. Put ngrok's own Google sign-in **in front** of it so only your Google account can even see the POS.

Create the policy file. With the **launcher** (normal case) save it as **`C:\POS\ngrok-policy.yml`** — it is git-ignored and `start-ngrok.bat` picks it up automatically. For the by-hand command (11.4) use `C:\ngrok\policy.yml`. The content is the same:

```yaml
on_http_request:
  - actions:
      - type: oauth
        config:
          provider: google
  - expressions:
      - "!(actions.ngrok.oauth.identity.email in ['you@yourcompany.com'])"
    actions:
      - type: deny
        config:
          status_code: 403
```

Replace the address with the Google account you will sign in with (the free plan includes 3 OAuth users a month). In addition: use strong POS passwords (Part 5), and keep the tunnel off when it is not needed if the client prefers (see 11.5).

### 11.4 Try it by hand first

With the POS server running on the client PC:

```powershell
C:\ngrok\ngrok.exe http 3000 --url https://YOUR-DOMAIN.ngrok-free.dev --traffic-policy-file C:\ngrok\policy.yml --config C:\ngrok\ngrok.yml
```

On **your** PC open `https://YOUR-DOMAIN.ngrok-free.dev` → click *Visit Site* → sign in with Google → the POS login page appears. `Ctrl+C` stops the tunnel. If ngrok rejects a flag, run `ngrok http --help` — flag names change between versions.

### 11.5 Start it automatically

**Simplest: the launcher.** `start-pos.bat` (Part 6) already starts the tunnel at every login and retries every 30 seconds if there is no internet. You need three things, all from 11.1–11.3:

1. ngrok installed and the authtoken saved: `ngrok config add-authtoken PASTE_AUTHTOKEN`.
2. **The lock:** save the Google sign-in policy as `C:\POS\ngrok-policy.yml`. **Without that file the tunnel is open to anyone who learns the address** — the launcher does not lock it by itself.
3. Optional, a fixed domain: set `NGROK_URL` at the top of `start-pos.bat`.

The tunnel then starts with the POS and keeps running as long as the user is logged in. Check the lock from another device or a private window: the address must ask for a Google sign-in and answer **403** for any account that is not yours.

**Alternative: a Windows service**, if the tunnel should run even when nobody is logged in:

Add the endpoint to `C:\ngrok\ngrok.yml`, below the lines `add-authtoken` already wrote:

```yaml
endpoints:
  - name: pos
    url: https://YOUR-DOMAIN.ngrok-free.dev
    upstream:
      url: 3000
    traffic_policy:
      on_http_request:
        - actions:
            - type: oauth
              config:
                provider: google
        - expressions:
            - "!(actions.ngrok.oauth.identity.email in ['you@yourcompany.com'])"
          actions:
            - type: deny
              config:
                status_code: 403
```

Check it, then install — in a **PowerShell opened as Administrator**:

```powershell
C:\ngrok\ngrok.exe config check --config C:\ngrok\ngrok.yml
C:\ngrok\ngrok.exe service install --config=C:\ngrok\ngrok.yml
C:\ngrok\ngrok.exe service start
```

Later: `ngrok service stop` (close the door when you are done), `ngrok service start`, `ngrok service uninstall`.

If the client wants the tunnel **off unless asked**, skip the service and use the 11.4 command when you ask them to run it (put it in a `support-tunnel.bat` on their desktop).

> The config keys above follow ngrok's v3 agent format. If `config check` complains, compare with ngrok's current "agent config v3" reference — I could not test this on a live account.

### 11.6 What you can and cannot do remotely

- **Everything in the browser works:** settings, users, items, reports, backups, restore, Google Drive connect. For Drive, either add `https://YOUR-DOMAIN.ngrok-free.dev/api/settings/backup/google/callback` to the Google OAuth client first, **or simply connect Drive on the client PC at `localhost`** as in Part 8 (simplest).
- Actions that touch the machine happen **on the client PC**, because that is where the server runs: *Test folder*, local backups, the Windows scheduled task, Restore.
- **Printing** from your session prints on *your* printer, not the shop's.
- For anything outside the browser (Windows settings, printer driver, Task Scheduler), use a remote-desktop tool (AnyDesk, RustDesk…).

### 11.7 Remove access when support ends

`ngrok service stop` (or `uninstall`), and in the ngrok dashboard **revoke the authtoken** if the contract ends.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Page won't load after reboot | The server didn't start. Run `wscript C:\POS\start-pos.vbs`, wait 20 s, and read `C:\POS\pos-server.log`. Check the Startup shortcut exists (`shell:startup`), PostgreSQL is running, and `node -v` works for that Windows user. |
| `The column X does not exist` / 500 errors after an update | Database not migrated: `npx prisma migrate deploy`. |
| Login loops or "Configuration" error | `NEXTAUTH_SECRET` missing/empty or `NEXTAUTH_URL` wrong in `.env`; rebuild after changing (`npm run build`). |
| Changes to `.env` or code have no effect | You must `npm run build` again, then restart the server. |
| Scheduled task shows **Not scheduled** | Save the schedule again as Super Admin; check "Run backups automatically" is ticked. Look at Task Scheduler for `POS_Database_Backup`. |
| Task exists but no backup appears | Open `C:\POS\backup.log`. Typical: `npm` not found for that user (reinstall Node with PATH ticked, log out/in), wrong database in `.env`, folder not writable (use **Test folder**). |
| History says **Failed** with a Drive message | See the Google rows below. Local backups continue even if Drive fails. |
| Google: **Error 403: access_denied** / "has not completed the verification process" | App is still in *Testing*. Publish it (8.1 step 5), or add the account under *Audience → Test users*. |
| Google: **redirect_uri_mismatch** | The address in the browser or in Google Cloud doesn't match. Use exactly `http://localhost:3000`, and the redirect URI from 8.1 step 6; wait a few minutes after saving in Google. |
| Google: connected for a week, then "access expired or revoked" / `invalid_grant` | The app was left in *Testing* (tokens last 7 days). Publish it, then **Reconnect**. |
| Google: "did not return a refresh token" | Remove the app at myaccount.google.com/permissions, then Connect again. |
| Google: storage quota exceeded | The client's Drive is full. Free space, or lower *Keep Drive backups for (days)*. |
| Console shows **"Blocked cross-origin request to Next.js dev resource /_next/hmr"** | Only appears with `npm run dev` (the developer's setup) when opened through an ngrok address. It does not happen on a client install, which runs `npm start`. For dev work add `allowedDevOrigins: ["your-domain.ngrok-free.dev"]` to `next.config.ts` and restart `npm run dev`. |
| Login page gives **500**; console says **"Can't reach database server at localhost:5432"** | PostgreSQL isn't running. `services.msc` → the `postgresql-x64-NN` service → Start, and set *Startup type* to **Automatic (Delayed Start)** so it comes up after a reboot. Then reload the page; the POS server does not need a restart. |
| ngrok address shows **ERR_NGROK_8012** / connection refused | ngrok is up but the POS server is not listening on port 3000. Start it (`wscript C:\POS\start-pos.vbs`) and retry. |
| ngrok address shows the **"You are about to visit…"** page | Normal on the free plan; click **Visit Site**. |
| ngrok address shows Google sign-in, then **403** | That Google account isn't in `policy.yml`'s allowed list. |
| ngrok errors about a monthly **limit** | Free-plan monthly transfer/request limit reached. Wait for the reset or use a paid plan. |
| Print dialog still appears | Chrome was already running when started. Close all Chrome windows and start it from the shortcut with `--kiosk-printing`. |
| Receipt prints on the wrong printer | Set the thermal printer as the Windows default (Part 9). |
| Restore says tables will be left **empty** | The backup file is older than some features. That list shows what a restore would wipe — read it before confirming. |

---

## Updating a client later

```powershell
# 1. Take a backup first: Settings → Backup → Save to local folder
# 2. Stop the server
C:\POS\stop-pos.bat
# 3. Get the new code (keeps .env and the ngrok policy: they are not in git)
cd C:\POS
git pull
npm install
npx prisma migrate deploy
npm run build
# 4. Start again
wscript C:\POS\start-pos.vbs
```

If the update changes the backup schedule code, open Settings → Backup and click **Save schedule** once so the Windows task is recreated.

---

## Quick reference

| What | Where / command |
| --- | --- |
| App address | `http://localhost:3000` |
| Install folder | `C:\POS` |
| Environment file | `C:\POS\.env` |
| Backup log | `C:\POS\backup.log` |
| Server / tunnel logs | `C:\POS\pos-server.log`, `C:\POS\ngrok.log` |
| Scheduled task | Task Scheduler → `POS_Database_Backup` |
| Run a backup by hand (CLI) | `cd C:\POS; npm run backup:run` |
| Migrate database | `npx prisma migrate deploy` |
| Rebuild after changes | `npm run build` |
| Start / stop | `wscript C:\POS\start-pos.vbs` / `C:\POS\stop-pos.bat` |
| Tunnel lock (Google sign-in) | `C:\POS\ngrok-policy.yml` (not in git) |
| Remote support tunnel | `ngrok service start` / `stop` (config in `C:\ngrok\ngrok.yml`) |
| More detail on backups | [docs/backup.md](docs/backup.md) |
