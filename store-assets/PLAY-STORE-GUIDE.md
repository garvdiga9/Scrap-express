# Scrap Express: Google Play Store kit

Everything needed to list the Scrap Express app on Google Play. The app is
the website wrapped as a "Trusted Web Activity", so every website update
reaches the app automatically.

## Files in this folder

| File | Where it goes in Play Console |
|---|---|
| `play-icon-512.png` | Store listing → App icon |
| `feature-graphic-1024x500.png` | Store listing → Feature graphic |
| `screenshot-1-home.jpg`, `screenshot-2-request.jpg`, `screenshot-3-quote.jpg` | Store listing → Phone screenshots |

## Store listing text (copy and paste)

**App name:** Scrap Express

**Short description** (max 80 characters):
> Bulk scrap pickup for businesses in Delhi NCR. Get quotes and track pickups.

**Full description:**
> Scrap Express buys scrap in bulk from factories, offices, hospitals, schools, malls, hotels and restaurant chains across Delhi NCR.
>
> With the app you can:
> • Request a one-time or scheduled bulk pickup (300 kg and above)
> • Attach photos and videos of your scrap for an accurate quote
> • Receive your quote in the app and accept it with one tap
> • Get notified when your quote is ready and when your pickup is confirmed
> • Track all your pickup and demolition requests in one place
> • Save your business details (GSTIN, site address) for faster booking
>
> Every pickup is weighed on a weighbridge, billed with a GST invoice and paid by bank transfer to your company account.
>
> We also handle demolition of commercial and institutional buildings, with a site survey and detailed quote.

**Category:** Business
**Contact email:** garvdiga13@gmail.com
**Phone:** +91 98188 26333
**Website:** https://scrap-express.onrender.com
**Privacy policy URL:** https://scrap-express.onrender.com/privacy

## App content forms

**Privacy policy:** https://scrap-express.onrender.com/privacy
**Ads:** No, the app does not contain ads.
**App access:** Most features work without logging in. For My Account,
give reviewers a Google test account, or say: "Login is optional (Google
sign-in); all booking features work without an account."
**Target audience:** 18 and over.
**Account deletion URL:** https://scrap-express.onrender.com/delete-account

### Data safety answers

- Does the app collect or share user data? **Yes, collects** (does **not** share).
- Is all data encrypted in transit? **Yes**.
- Can users request that their data be deleted? **Yes** (in app, and at the URL above).

Data collected (all for **App functionality** and **Account management**; none are optional unless noted):

| Data type | Collected | Why |
|---|---|---|
| Personal info → Name | Yes | Contact person on requests, account |
| Personal info → Email address | Yes | Google sign-in, contact (optional on requests) |
| Personal info → Phone number | Yes | Contact for pickups |
| Personal info → Address | Yes | Pickup / site address |
| Personal info → Other info | Yes | Company name, GSTIN (optional) |
| Photos and videos → Photos, Videos | Yes | Attached to requests for quoting |
| Device or other IDs | Yes (optional) | Push notification token, only if notifications are turned on |

Not collected: location, contacts, financial/payment info, messages, health, app activity or analytics.

## Building the app package (once)

1. Go to **https://www.pwabuilder.com**, enter `https://scrap-express.onrender.com` and click **Start**.
2. Click **Package for stores → Android → Generate Package**.
   - Package ID: `com.scrapexpress.app`
   - App name: `Scrap Express`, short name: `Scrap Express`
   - Leave the signing key option as **"Create new"**.
3. Download the zip. **Keep it safe forever**: it contains `signing.keystore`
   and `signing-key-info.txt`. Without them you can never update the app.
   Store copies in Google Drive and on a pen drive.
4. Inside the zip is the `.aab` file you upload to Play Console.

## After uploading to Play Console

Play Console → **Test and release → App integrity → App signing**: copy the
**SHA-256 certificate fingerprint** of the *App signing key certificate*.
Add it on Render (scrap-express → Environment) as
`ANDROID_SHA256_CERT_FINGERPRINTS`. If you also want the PWABuilder upload
key to work, add both, separated by a comma. This makes the app open
full-screen with no browser address bar. Check it at
https://scrap-express.onrender.com/.well-known/assetlinks.json

## Personal Play accounts: the testing rule

New personal developer accounts must run a **closed test with at least 12
testers for 14 days in a row** before they can publish publicly. Add
friends, family and staff (their Gmail addresses) as testers. Each must
opt in and install the app from the test link.
