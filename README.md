# Sahiba CRM Dashboard

Wholesale fashion CRM for **SAHIBA** — women's wholesale fashion, Mexico City.

## Architecture

- **Frontend**: Single-file HTML dashboard (Vanilla JS)
- **Backend**: Netlify Functions (serverless Node.js)
- **Database**: Neon PostgreSQL (persistent storage)
- **Hosting**: Netlify (auto-deploy from GitHub)

## Features

- **Persistent Data** — Data stays in Neon until you upload new files
- **New Contact Detection** — 🆕 flags contacts that didn't exist in the previous upload
- **Agent Task Queues** — Dedicated call lists for Jazmin, Nancy, and Yoana
- **Agent Check-ins** — ✅ Called, 💬 Messaged, ❌ No Answer, 📅 Callback
- **Lead Map** — Visual map of Mexico showing lead hotspots by city
- **Buy-Likelihood Scoring** — 0-200+ point algorithm based on message patterns
- **Priority System** — P1/P2/P3 + PAID detection
- **Excel Export** — Download call lists and reports
- **WhatsApp Integration** — Direct message links

## Setup

### 1. Create Neon Database

1. Go to [neon.tech](https://neon.tech)
2. Create a project
3. Copy the connection string

### 2. Deploy to Netlify

1. Push this repo to GitHub
2. Connect to Netlify
3. Add environment variable: `DATABASE_URL` = your Neon connection string
4. Deploy

### 3. Upload Data

1. Export **Contacts** and **Messages** CSVs from Respond.io
2. Open the dashboard
3. Drop CSVs → click **📤 Upload & Update**
4. All agents see the same data

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data` | Load all CRM data |
| POST | `/api/upload` | Upload new CSV data |
| POST | `/api/checkin` | Log agent check-in |
| GET | `/api/logs` | Get agent activity logs |
| GET | `/api/status` | Database status |
