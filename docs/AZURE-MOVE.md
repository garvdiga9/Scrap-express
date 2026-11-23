# Moving ScrapDilli from Render to Azure

Target: **Azure App Service (Linux, Node 22) + Azure Database for PostgreSQL
Flexible Server + Azure Files for photos**, all in **Central India (Pune)**.
Data stays in India, which also covers the CERT-In point about logs.

Render keeps running until step 7, so customers see no break. Best done
together with buying scrapdilli.com and Cloudflare (January–February 2027).

Secrets (passwords, keys) are typed into the Azure portal by you, never
pasted into chat or committed to GitHub.

---

## 0. Account and safety (once)
1. Sign up for **Azure for Students** with the college email (no card).
   Check the credit shown on the dashboard.
2. Turn on two-step verification on the Microsoft account.
3. **Cost Management → Budgets**: create a monthly budget of about US$40
   with email alerts at 50 %, 80 % and 100 %.
4. Create one **Resource group** called `scrapdilli`, region **Central India**.
   Everything below goes in it, so it can all be seen (or deleted) together.

## 1. Database: Azure Database for PostgreSQL (Flexible Server)
- Create → *Flexible server*, name e.g. `scrapdilli-db`, region Central India.
- Version **17**. Workload: *Development* → **Burstable B1ms**, 32 GB storage,
  storage auto-grow on, backup retention **7 days** (or more).
- High availability: off (turn on later if needed; it doubles the price).
- Authentication: *PostgreSQL authentication*. Choose an admin name and a long
  password; keep it in your password manager.
- Networking: *Public access*, tick **"Allow public access from any Azure
  service"**. While moving the data, also **add your current IP address**
  (remove it afterwards).
- After it's created: **Databases → Add** a database called `scrapdilli`.

The connection address looks like:

```
postgres://ADMIN:PASSWORD@scrapdilli-db.postgres.database.azure.com:5432/scrapdilli?sslmode=require
```

`?sslmode=require` is needed: Azure only accepts encrypted connections.
If the password has symbols like `@ # / ?`, write them URL-encoded
(e.g. `@` → `%40`).

## 2. Photo storage: Azure Files
- Create a **Storage account** (Standard, LRS, Central India), e.g. `scrapdillifiles`.
- In it: **File shares → + File share** called `uploads` (Transaction optimized).
- Data protection: turn on **soft delete for file shares** (7 days).

## 3. The website: App Service
- Create → **Web App**: name e.g. `scrapdilli` (gives
  `scrapdilli.azurewebsites.net`), *Code*, runtime **Node 22 LTS**, **Linux**,
  region Central India.
- Pricing plan: **Basic B1** (Free F1 sleeps and has no custom domain).
- Then in the Web App:
  - **Configuration → General settings**
    - Startup command: `npm run start:prod`
      (sets up the tables, then starts the site, same as on Render)
    - **Always on: On**, HTTPS only: On, Minimum TLS 1.2, FTP: Disabled.
  - **Configuration → Path mappings → New Azure Storage Mount**
    - Name `uploads`, storage account `scrapdillifiles`, *Azure Files*,
      share `uploads`, mount path **`/mounts/uploads`**.
  - **Health check**: path `/healthz`.
  - **App Service logs**: Application logging → File system, keep 30 days
    (or send to a Log Analytics workspace to keep 180 days for CERT-In).

## 4. Settings (App Service → Environment variables)
Copy every value from **Render → Environment** one by one, then change these:

| Name | Value on Azure |
|---|---|
| `DATABASE_URL` | the Azure address from step 1 |
| `UPLOAD_DIR` | `/mounts/uploads` |
| `NODE_ENV` | `production` |
| `SITE_URL` | **for testing:** `https://scrapdilli.azurewebsites.net` (otherwise the site forwards visitors to Render) |
| `SESSION_SECRET` | same as Render (or a new long random text: everyone logs in again) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | same as Render |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` (GitHub already installs the packages) |

Everything else is copied as is: `FIREBASE_*`, `SMTP_*`, `WHATSAPP_*`,
`BRAND_*`, `GA_MEASUREMENT_ID`, `ANDROID_*`, `GOOGLE_SITE_VERIFICATION`,
`BING_SITE_VERIFICATION`. The app-alert keys are inside the database, so
alerts keep working after the move.

## 5. Connect GitHub (deploys)
1. Web App → **Overview → Download publish profile**.
2. GitHub → repo → **Settings → Secrets and variables → Actions**:
   - Secret `AZURE_WEBAPP_PUBLISH_PROFILE` = the whole file's text.
   - Variable `AZURE_WEBAPP_NAME` = `scrapdilli`.
3. GitHub → **Actions → Deploy to Azure → Run workflow**.
4. Open `https://scrapdilli.azurewebsites.net/healthz` → it should say OK.
   The site now runs on Azure with an empty database (just the default rates).

## 6. Test copy of the data (a rehearsal)
1. On the live site: **Admin → Team → Backups → Download** (includes photos).
2. On the laptop, in the project folder, restore it into Azure:

   ```
   $env:DATABASE_URL = "<Azure address from step 1>"
   $env:UPLOAD_DIR = "C:\temp\azure-uploads"
   node scripts/restore.js "C:\path\to\backup.tar.gz" --replace-existing-data
   ```

3. Upload the contents of `C:\temp\azure-uploads` into the `uploads` file share
   (Storage account → File shares → uploads → *Upload*, or the free
   **Azure Storage Explorer** app for whole folders).
4. Restart the Web App, then check on `scrapdilli.azurewebsites.net`:
   admin login, rates, an old pickup with photos, staff app login, a test
   booking (then delete it), customer Google login (add
   `scrapdilli.azurewebsites.net` in Firebase → Authentication → Authorized
   domains first), app alerts, Hindi pages.

## 7. The real switch (a quiet evening, about 30 minutes)
1. Tell the staff not to use the app for 30 minutes.
2. Download a **fresh backup** from Render and repeat step 6.2–6.3
   (with `--replace-existing-data`).
3. Point the address at Azure:
   - With the new domain: Web App → **Custom domains → Add** `scrapdilli.com`
     and `www`, add the DNS records it shows at the domain seller (or in
     Cloudflare, set to *DNS only* until the certificate is issued), then
     **Add a free App Service managed certificate**.
   - Set `SITE_URL` = `https://scrapdilli.com` on Azure, restart.
   - Add `scrapdilli.com` to Firebase Authorized domains.
4. On **Render**, set `SITE_URL` = `https://scrapdilli.com` too, so anyone
   still using the old onrender address is forwarded to the new one.
   Stop the staff and admin using Render from now on.
5. Check everything from step 6.4 again on the real address.
6. Update: UptimeRobot monitor, Google Search Console (new property +
   sitemap), Google Business Profile website link, Play app (if already
   released, the domain in the app's settings).

## 8. After the move
- Keep Render (stopped database writes, forwarding only) for **2 weeks**, then
  download one last backup and delete the Render service and database.
- Remove your laptop's IP from the database firewall.
- Check the monthly cost in Cost Management after the first week.
- Weekly backups from Admin → Team → Backups continue as before; Azure also
  keeps its own daily database backups (7 days).

## If something goes wrong during the switch
Nothing is deleted on Render until step 8, so going back is: set `SITE_URL`
back to the Render address on Render, point the domain DNS back to Render,
and keep working there. Then try again another day.
