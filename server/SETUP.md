# Sign-in helper on Ecto-Server

The helper keeps each phone signed in to Google, so the Meal Planner never needs the sign-in popup or the
"sign in" tap again. It never sees meal planner data: phones still talk to Google Drive directly. It holds only
each phone's long-lasting Google sign-in, encrypted so only the Windows account running it can read it.

**Setup:** about 30 minutes, done once. You need Ecto-Server, the Cloudflare dashboard for `feralservers.au`, and the
Google Cloud console project the app already uses.

The address below is `meals.feralservers.au`. Any name on the domain works; just use the same one everywhere.

## 1. Python

Open PowerShell on Ecto-Server and run `python --version`. If it isn't 3.10 or newer, install Python from
python.org (tick **Add python.exe to PATH**). The helper uses nothing outside Python itself.

## 2. Put the helper on Ecto-Server

1. Make a folder, for example `C:\Services\mp-auth`.
2. Copy `mp_auth.py` from this folder into it.
3. Create `mp-auth.config.json` there (step 4 fills in the secret):

```json
{
  "client_id": "99004060688-hr3dkecj5kh9gqh6gghkb5r6tqk8adpd.apps.googleusercontent.com",
  "client_secret": "PASTE FROM STEP 4",
  "public_url": "https://meals.feralservers.au",
  "allowed_origins": ["https://bradwhiteau.github.io"],
  "port": 8790
}
```

The helper only listens on `127.0.0.1` (this machine), so nothing on your network or router can reach it
directly. Cloudflare's tunnel is the only way in.

## 3. Cloudflare Tunnel (no router changes)

1. In the Cloudflare dashboard go to **Zero Trust → Networks → Tunnels → Create a tunnel** and choose **Cloudflared**.
   Name it `ecto-server`.
2. It shows a Windows install command. Run it in PowerShell **as administrator** on Ecto-Server. This installs
   `cloudflared` as a Windows service, which starts with the machine.
3. Under **Public Hostname**, add:
   - Subdomain `meals`, domain `feralservers.au`.
   - Service type **HTTP**, URL `localhost:8790`.
4. Save. The game servers' port forwarding isn't affected.

## 4. Google Cloud console

In <https://console.cloud.google.com/> with the meal planner project selected:

1. Go to **APIs & Services → Credentials** and open the existing **Web client** (the ID in step 2).
2. Under **Authorised redirect URIs**, add `https://meals.feralservers.au/callback`. Save.
3. On the same page, copy the **Client secret** into `mp-auth.config.json`.
   - The secret stays on Ecto-Server. Never put it in the repo or a chat.
   - If you'd rather not reuse the existing secret, use **Add secret**.
4. If Google asks you to add `feralservers.au` under **OAuth consent screen → Authorised domains**, add it. It may
   ask you to prove you own the domain through Search Console, which means adding a TXT record in Cloudflare DNS.

## 5. Start it, and keep it running

Test it by hand first:

```powershell
cd C:\Services\mp-auth
python mp_auth.py
```

It should print `Meal Planner sign-in helper on http://127.0.0.1:8790 …`. Open
<https://meals.feralservers.au/health> on your phone and you should see `ok`. Then press Ctrl+C to stop it.

To have it start with the machine, use Task Scheduler:

1. **Create Task** (not Basic Task). Name it `Meal Planner sign-in helper`.
2. Tick **Run whether user is logged on or not**. Use **your own Windows account**, the same one you tested
   with, because the stored sign-ins are encrypted to it.
3. **Triggers:** At startup.
4. **Actions:** Start a program.
   - Program: `python` (or the full path from `where python`).
   - Arguments: `mp_auth.py`.
   - Start in: `C:\Services\mp-auth`.
5. **Settings:** tick **If the task fails, restart every 1 minute**, and untick **Stop the task if it runs longer than**.
6. Right-click the task and choose **Run**, then check `/health` again.

## 6. Turn it on in the app

Tell Claude the address (for example `https://meals.feralservers.au`). Claude adds it to `config.js` as
`authServer` and publishes. The address isn't a secret.

Then on each phone, tap the chip once. The app goes to Google, asks for Drive access (tick both boxes) and comes
back. Settings → Data then says **sign-in helper on (stays signed in)**. From then on the app gets fresh access
by itself.

## Good to know

- **If Ecto-Server is down,** the app shows "Couldn't reach the sign-in helper". The next tap uses Google's
  popup, as before. No data is at risk.
- **To sign a phone out,** use Settings → Google Drive → Sign out. That tells the helper to forget it. To forget
  everyone at once, stop the task and delete `mp-auth-sessions.json`.
- **Sign-ins Google drops on its side,** for example after 6 months unused or when access is removed at
  <https://myaccount.google.com/permissions>, are forgotten. The app then asks for one tap to sign in again.
- **Keep Ecto-Server patched.** Anyone who got control of that Windows account could read the Google Drive of
  everyone signed in through it.
- **The log** prints only sign-ins and sign-outs (by email), never tokens.
- **Updating:** replace `mp_auth.py` and restart the task. Signed-in phones stay signed in.
- **Tests:** `python -I test_mp_auth.py` (Google is faked).
