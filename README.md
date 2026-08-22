# Kabadi Express — Online Scrap Pickup Website

A full website for a Delhi-based scrap dealing business: a customer-facing site (live rates, pickup booking, testimonials, areas served) plus a password-protected admin dashboard, backed by PostgreSQL.

- **Frontend:** plain HTML, CSS, JavaScript (`public/`)
- **Backend:** Node.js + Express (`server.js`, `routes/`)
- **Database:** PostgreSQL (`db/`)

## 1. Install prerequisites (one-time)

You need two things installed on your computer:

1. **Node.js** (v18 or newer) — download from https://nodejs.org and install the LTS version.
2. **PostgreSQL** (v14 or newer) — download from https://www.postgresql.org/download/windows/ and install it. During setup it will ask you to set a password for the `postgres` user — remember it.

After installing, open a **new** terminal and verify:

```
node -v
npm -v
psql --version
```

## 2. Create the database

Open the terminal and run (it will ask for the postgres password you set during install):

```
psql -U postgres -c "CREATE DATABASE kabadi_express;"
```

## 3. Configure environment variables

In this project folder, copy `.env.example` to `.env`:

```
copy .env.example .env
```

Then open `.env` and edit:

- `DATABASE_URL` — set the password to the one you chose for the `postgres` user.
- `SESSION_SECRET` — replace with any long random string.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — the login you'll use for `/admin.html`. Change the password before going live.

## 4. Install dependencies & set up the database tables

From this project folder:

```
npm install
npm run migrate
npm run seed
```

- `npm run migrate` creates the tables (scrap categories, pickup requests, testimonials, admin user).
- `npm run seed` inserts your admin login, a starter set of scrap rates, and a few sample reviews.

## 5. Run the website

```
npm start
```

Then open:

- **Customer site:** http://localhost:3000
- **Admin dashboard:** http://localhost:3000/admin.html (log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env`)

## What you can manage from the admin dashboard

- **Pickup Requests** — view every booking submitted from the website, update its status (pending / confirmed / completed / cancelled), or delete it.
- **Scrap Rates** — the prices shown on the public "Live Scrap Rates" section. Edit prices inline, add new categories, or remove old ones.
- **Testimonials** — the reviews shown in the "What Delhi Says About Us" section. Add new ones as customers give feedback, or remove old ones.

## Customizing the site

- **Business name, phone number, email, address:** search for `Kabadi Express`, `+91 99999 99999`, and `hello@kabadiexpress.in` in `public/index.html` / `public/admin.html` and replace with your real details.
- **Colors:** edit the CSS variables at the top of `public/css/style.css` (`:root { ... }`).
- **Areas served:** edit the badge list in the "Areas We Serve" section of `public/index.html`.

## Project structure

```
db/            schema.sql, migrate.js (creates tables), seed.js (starter data)
middleware/    session-based admin auth guard
routes/        /api/rates, /api/pickup, /api/testimonials, /api/admin/*
public/        the actual website (index.html, admin.html, css/, js/)
server.js      Express app entry point
```
