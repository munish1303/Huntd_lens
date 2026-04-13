# Huntd Lens

Huntd Lens is a Chrome extension that overlays a sidebar on any LinkedIn (person or company) profile page. It reads the page, scores the person against your Ideal Customer Profile (ICP), detects which competitor tools their company uses, and gives you a copy-ready outreach template — all without leaving LinkedIn.

---

## Table of Contents

1. [What it does](#what-it-does)
2. [Architecture overview](#architecture-overview)
3. [How each layer works](#how-each-layer-works)
4. [What the data means](#what-the-data-means)
5. [ICP Score explained](#icp-score-explained)
6. [Prerequisites](#prerequisites)
7. [Installation from this repo](#installation-from-this-repo)
8. [Environment variables](#environment-variables)
9. [Running the backend](#running-the-backend)
10. [Loading the extension in Chrome](#loading-the-extension-in-chrome)
11. [Configuring the extension](#configuring-the-extension)
12. [Using Huntd Lens](#using-huntd-lens)
13. [API reference](#api-reference)
14. [Development mode and mock data](#development-mode-and-mock-data)
15. [Troubleshooting](#troubleshooting)
16. [Project file structure](#project-file-structure)

---

## What it does

When you open a LinkedIn profile or company page, Huntd Lens automatically:

1. Reads the person's name, job title, company, company size, tenure, and LinkedIn activity from the page DOM (Document Object Model — the live HTML structure of the page).
2. Sends that data to a local Node.js backend.
3. The backend queries the Huntd API (or mock data in development) to find which competitor sales tools the company uses.
4. Calculates an ICP (Ideal Customer Profile) score from 0–100.
5. Renders a dark-themed sidebar on the right side of the page showing the score, competitor tools, matched contacts, and a one-click outreach template.

---

## Architecture overview

```
LinkedIn page (browser)
        │
        │  DOM scraping (content script)
        ▼
Chrome Extension (Manifest V3)
  ├── content/content.js      — runs on every linkedin.com/in/* and /company/* page
  ├── content/sidebar.js      — renders the sidebar UI
  ├── background/background.js — service worker, handles API calls
  └── popup/popup.js          — settings UI (API key, backend URL, on/off toggle)
        │
        │  HTTP POST  x-api-key header
        ▼
Node.js Backend (Express)
  ├── middleware/auth.js       — validates the API key
  ├── middleware/rateLimit.js  — 100 requests per hour per IP
  ├── middleware/cache.js      — LRU (Least Recently Used) in-memory cache, 6-hour TTL
  ├── routes/profile.js        — main enrichment endpoint
  ├── services/huntdService.js — calls the Huntd external API
  ├── services/icpScorer.js    — calculates the ICP score
  └── services/linkedinScraper.js — normalises incoming profile data
        │
        │  HTTP POST  Bearer token
        ▼
Huntd API  (https://api.gethuntd.com)
  └── /external/company-lookup — returns competitor tool usage per domain
```

---

## How each layer works

### Layer 1 — Content Script (`content/content.js`)

This JavaScript file is injected by Chrome into every page matching `https://www.linkedin.com/in/*` and `https://www.linkedin.com/company/*`. It runs after the page has finished loading (`document_idle`).

**What it does:**

- Waits 1.5 seconds for LinkedIn's Single Page Application (SPA) to finish rendering.
- Walks the DOM to extract:
  - **Full name** — from the `<h1>` element, stripping degree badges like "· 2nd".
  - **Job title / headline** — from LinkedIn's headline div below the name.
  - **Company name** — from company links in the top card, or parsed from `@CompanyName` in the headline.
  - **Company size** — from the org info list or any text node matching a pattern like "1K–5K employees".
  - **Tenure in months** — from the experience section date range (e.g. "Jan 2022 – Present").
  - **LinkedIn activity days** — from post timestamps if visible (e.g. "3d" = 3 days ago).
- Retries up to 5 times with 2-second gaps if the DOM hasn't rendered the name yet.
- Sends the extracted data to the background service worker via `chrome.runtime.sendMessage`.
- Dynamically imports `sidebar.js` and `scorer.js` as ES modules at runtime.

**Why it can't use `import` at the top level:** Chrome content scripts run in a special isolated world. The dynamic `import(chrome.runtime.getURL(...))` pattern is used to load ES modules from the extension's own files.

---

### Layer 2 — Background Service Worker (`background/background.js`)

The service worker is a persistent background script that handles all network requests. Content scripts cannot make cross-origin HTTP requests directly, so they message the background worker which does it on their behalf.

**Message types handled:**

| Message type | What it does |
|---|---|
| `FETCH_PROFILE_DATA` | POSTs to the backend `/api/profile` endpoint with the scraped profile data |
| `GET_SETTINGS` | Reads API key, backend URL, and enabled flag from `chrome.storage.local` |
| `SAVE_SETTINGS` | Writes settings to `chrome.storage.local` |
| `OPEN_POPUP` | Opens the extension popup programmatically |

**Timeout:** The fetch to the backend has a 12-second timeout via `AbortController`. If the backend doesn't respond in time, a `NETWORK_ERROR` is returned to the content script.

---

### Layer 3 — Sidebar UI (`content/sidebar.js` + `content/sidebar.css`)

`sidebar.js` is a plain JavaScript module (no framework) that creates and updates a `<div id="huntd-lens-sidebar">` injected directly into the LinkedIn page body.

**States it handles:**

- **Loading** — skeleton shimmer animation while waiting for data.
- **NO_API_KEY** — prompts the user to open settings.
- **NETWORK_ERROR** — shows a retry button.
- **Success** — renders the full profile card, ICP score ring, competitor tools, contacts, and action buttons.
- **Offline fallback** — if the backend is unreachable for any other reason, renders a locally-calculated ICP score with a "⚠ Local score" footer note.

---

### Layer 4 — Backend (`backend/server.js`)

A Node.js + Express HTTP server. Uses ES Modules (`"type": "module"` in `package.json`).

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check — returns `{ status: "ok", timestamp }` |
| `POST` | `/api/profile` | Main enrichment endpoint |

**Middleware stack on `POST /api/profile`:**

1. **Auth** (`middleware/auth.js`) — checks the `x-api-key` request header against `EXTENSION_API_KEY` in `.env`. Returns HTTP 401 (Unauthorized) if missing or wrong.
2. **Rate limit** (`middleware/rateLimit.js`) — allows a maximum of 100 requests per IP address per hour using `express-rate-limit`. Returns HTTP 429 (Too Many Requests) if exceeded.
3. **Cache check** (`middleware/cache.js`) — before hitting the Huntd API, checks an in-memory LRU (Least Recently Used) cache keyed by `profile:{companyDomain}:{fullName}`. Cache entries live for 6 hours and the cache holds up to 500 entries. If a hit is found, returns immediately with `cached: true`.
4. **Huntd API call** (`services/huntdService.js`) — POSTs to `HUNTD_API_BASE/external/company-lookup` with the company domain and a list of competitor tool names to check. Has an 8-second timeout. In `development` mode, if the API call fails, returns hardcoded mock data instead of throwing.
5. **ICP scoring** (`services/icpScorer.js`) — calculates the score (see ICP Score section below).
6. **Response** — assembles and returns the enriched profile JSON, then stores it in the cache.

---

### Layer 5 — Huntd API (`services/huntdService.js`)

This service calls the external Huntd API at `HUNTD_API_BASE/external/company-lookup`. It sends:

```json
{
  "domain": "deel.com",
  "sources": ["gong", "retool", "clay", "outreach", "salesloft", "hubspot", "salesforce", "apollo", "zoominfo"]
}
```

It expects back a JSON object where each key is a tool name and the value is an array of contacts at that company who use that tool:

```json
{
  "Gong": [
    {
      "firstName": "Alex",
      "lastName": "Rivera",
      "email": "alex.rivera@deel.com",
      "jobTitle": "VP Sales",
      "linkedinUrl": "https://linkedin.com/in/alex-rivera",
      "linkedinActivityDays": 5
    }
  ],
  "HubSpot": [ ... ],
  "Retool": []
}
```

Tools with empty arrays are filtered out before the response is sent to the extension.

> **Note:** `api.gethuntd.com` is a placeholder endpoint. In development mode (`NODE_ENV=development`), the service automatically falls back to hardcoded mock data (always Gong + HubSpot) when the real API is unreachable. To use real data, replace this with Apollo.io, Clay, Clearbit, or any enrichment API that can return tool usage by company domain.

---

## What the data means

### Profile card

| Field | What it is |
|---|---|
| Name | The person's full name scraped from the LinkedIn `<h1>` |
| Job title | Their current headline/role as shown on LinkedIn |
| Company | Their current employer, extracted from the top card or parsed from the headline |

### ICP Score breakdown bars

| Bar | What it measures |
|---|---|
| **Activity** | How recently they posted on LinkedIn. Someone who posted in the last 7 days scores highest — they're active and reachable. Someone who hasn't posted in 60+ days scores 0. |
| **Title** | Their seniority level. A CEO (Chief Executive Officer), CRO (Chief Revenue Officer), VP (Vice President), or Chief-level title scores 30/30. A Director or Head scores 22. A Manager or Lead scores 15. Anyone else scores 8. |
| **Tenure** | How long they've been in their current role. 12–36 months is the sweet spot (settled in, not entrenched) and scores 20/20. Under 6 months scores 5 (too new to make decisions). Over 5 years scores 8 (likely locked in). |

### Competitor tools detected

These are the sales/marketing tools the company is known to use, sourced from the Huntd API. Each pill represents one tool. The contacts listed below them are people at that company associated with that tool.

### Contacts

Up to 4 contacts are shown. These are real people at the company who are linked to the detected tools. They are matched first by LinkedIn URL, then by email pattern against the person's name.

---

## ICP Score explained

**ICP = Ideal Customer Profile**

An ICP score answers the question: *"How well does this person match the type of customer most likely to buy from us right now?"*

The score is calculated out of a maximum of **100 points** across five dimensions:

| Dimension | Max points | Scoring logic |
|---|---|---|
| Job title seniority | 30 | CEO/CRO/VP/Chief = 30, Director/Head = 22, Manager/Lead = 15, Other = 8 |
| Company size fit | 20 | 11–200 employees = 20 (best fit), 201–500 = 18, 501–1000 = 14, 1–10 = 10, 1000+ = 8 |
| Tenure in current role | 20 | 12–36 months = 20, 6–12 months = 15, 36–60 months = 12, 60+ months = 8, <6 months = 5 |
| LinkedIn activity recency | 20 | ≤7 days = 20, ≤14 days = 16, ≤30 days = 10, ≤60 days = 5, >60 days = 0 |
| Competitor tools detected | 10 | 2 points per tool detected, capped at 10 |

**Labels:**

| Score range | Label | Meaning |
|---|---|---|
| 75–100 | 🔴 Hot | Strong fit across multiple dimensions. Prioritise outreach immediately. |
| 50–74 | 🟡 Warm | Decent fit. Worth a follow-up, but not urgent. |
| 0–49 | ⚪ Cold | Weak fit. Low seniority, inactive, or wrong company size. |

The same scoring logic runs both on the backend (`services/icpScorer.js`) and as a client-side fallback in the extension (`utils/scorer.js`) so the sidebar can still show a score even when the backend is offline.

---

## Prerequisites

- **Node.js** v20 or higher — [nodejs.org](https://nodejs.org)
- **npm** v9 or higher (comes with Node.js)
- **Google Chrome** v114 or higher
- A terminal / command prompt

---

## Installation from this repo

### Step 1 — Clone the repository

```bash
git clone <your-repo-url>
cd <repo-folder>/huntd-lens
```

### Step 2 — Install backend dependencies

```bash
cd backend
npm install
```

This installs:

| Package | Purpose |
|---|---|
| `express` | HTTP server framework |
| `cors` | Cross-Origin Resource Sharing middleware — allows the extension to call the backend |
| `dotenv` | Loads `.env` file into `process.env` |
| `express-rate-limit` | Rate limiting middleware |
| `lru-cache` | Least Recently Used in-memory cache |
| `node-fetch` | `fetch()` API for Node.js (used to call the Huntd API) |
| `winston` | Structured JSON logging |

### Step 3 — Set up the backend environment file

```bash
cp .env.example .env
```

Then open `.env` and fill in the values (see [Environment variables](#environment-variables) below).

The extension has no build step — it loads directly as unpacked source files.

---

## Environment variables

All variables go in `huntd-lens/backend/.env`.

```env
# Port the Express server listens on
PORT=3002

# Your Huntd platform API key — used to authenticate calls to api.gethuntd.com
# Get this from your Huntd dashboard at app.gethuntd.com
HUNTD_API_KEY=your_huntd_api_key_here

# Base URL of the Huntd external API
HUNTD_API_BASE=https://api.gethuntd.com

# A secret string you make up yourself — the extension sends this in the
# x-api-key header on every request. The backend checks it matches this value.
# Use any long random string, e.g.: openssl rand -hex 32
EXTENSION_API_KEY=your_self_generated_secret_here

# Set to "development" to enable mock data fallback when the Huntd API is unreachable.
# Set to "production" for live deployments.
NODE_ENV=development
```

### What each variable does

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (defaults to 3001) | The TCP port the backend HTTP server binds to |
| `HUNTD_API_KEY` | Yes (for live data) | Bearer token sent to `api.gethuntd.com`. In development with mock data, any value works. |
| `HUNTD_API_BASE` | Yes | The base URL of the Huntd API. Do not add a trailing slash. |
| `EXTENSION_API_KEY` | Yes | Shared secret between the extension and backend. Make this a long random string. Anyone with this key can call your backend. |
| `NODE_ENV` | No (defaults to undefined) | When set to `development`, the backend returns mock competitor data if the Huntd API call fails instead of throwing a 500 error. |

---

## Running the backend

### Development (with auto-restart on file changes)

```bash
cd huntd-lens/backend
npm run dev
```

Uses `node --watch` which restarts the server automatically when any `.js` file changes.

### Production

```bash
cd huntd-lens/backend
npm start
```

You should see:

```json
{"level":"info","message":"Huntd Lens backend running on port 3002","timestamp":"..."}
```

### Verify it's working

```bash
curl http://localhost:3002/api/health
```

Expected response:

```json
{"status":"ok","timestamp":"2026-04-14T..."}
```

---

## Loading the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Navigate to and select the `huntd-lens/extension/` folder
5. The Huntd Lens extension will appear in your extensions list

**After making any changes to extension files**, click the refresh icon (↺) on the extension card in `chrome://extensions` to reload it. You do not need to re-install.

---

## Configuring the extension

1. Click the Huntd Lens icon in the Chrome toolbar (puzzle piece → Huntd Lens)
2. **API Key** — enter the same value you set as `EXTENSION_API_KEY` in your `.env` file. This is not your Huntd platform key — it's the shared secret between the extension and your local backend.
3. **Backend URL** — enter `http://localhost:3002` (or whatever port you set in `.env`). Must start with `http://` or `https://`.
4. **Extension enabled** — toggle on.
5. Click **Save settings**.

---

## Using Huntd Lens

1. Go to any LinkedIn profile: `https://www.linkedin.com/in/someone`
   or any company page: `https://www.linkedin.com/company/somecompany`
2. Wait 1–3 seconds for the sidebar to appear on the right side of the page.
3. The sidebar shows:
   - **Profile card** — name, headline, company
   - **ICP Score** — 0–100 with Hot / Warm / Cold label and breakdown bars
   - **Competitor tools detected** — pills for each tool the company uses
   - **Contacts** — up to 4 people at the company linked to those tools
   - **Copy template** — copies a personalised outreach email to your clipboard
   - **View in Huntd →** — opens the Huntd dashboard filtered to that company's domain
4. Click **×** to close the sidebar.

---

## API reference

### `GET /api/health`

No authentication required.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-04-14T10:00:00.000Z"
}
```

---

### `POST /api/profile`

**Headers:**

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-api-key` | Your `EXTENSION_API_KEY` value |

**Request body:**

```json
{
  "linkedinUrl": "https://www.linkedin.com/in/jeff-ruby",
  "profileData": {
    "fullName": "Jeff Ruby",
    "jobTitle": "Senior Director of Sales @Deel",
    "companyName": "Deel",
    "companyDomain": "deel.com",
    "companySize": "1K–5K employees",
    "tenureMonths": 18,
    "linkedinActivityDays": 4
  }
}
```

**Successful response (HTTP 200):**

```json
{
  "cached": false,
  "profile": {
    "fullName": "Jeff Ruby",
    "jobTitle": "Senior Director of Sales @Deel",
    "companyName": "Deel",
    "linkedinUrl": "https://www.linkedin.com/in/jeff-ruby"
  },
  "competitorTools": [
    {
      "toolName": "Gong",
      "contacts": [
        {
          "firstName": "Alex",
          "lastName": "Rivera",
          "email": "alex.rivera@deel.com",
          "jobTitle": "VP Sales",
          "linkedinUrl": "https://linkedin.com/in/alex-rivera",
          "linkedinActivityDays": 5
        }
      ]
    }
  ],
  "icpScore": {
    "score": 72,
    "breakdown": {
      "jobTitle": 22,
      "companySize": 14,
      "tenure": 20,
      "activity": 16,
      "tools": 2
    },
    "label": "Warm"
  },
  "huntdDashboardUrl": "https://app.gethuntd.com/dashboard?domain=deel.com",
  "fetchedAt": "2026-04-14T10:00:00.000Z"
}
```

**Error responses:**

| HTTP status | Meaning |
|---|---|
| 400 Bad Request | `linkedinUrl` is missing or malformed, or `profileData` is not an object |
| 401 Unauthorized | `x-api-key` header is missing or does not match `EXTENSION_API_KEY` |
| 429 Too Many Requests | More than 100 requests from this IP in the last hour |
| 500 Internal Server Error | Huntd API call failed in production mode |

---

## Development mode and mock data

When `NODE_ENV=development` and the Huntd API call fails (network error, bad credentials, or the endpoint doesn't exist), `huntdService.js` returns this hardcoded mock response instead of throwing:

```json
{
  "Gong": [{ "firstName": "Alex", "lastName": "Rivera", "jobTitle": "VP Sales", ... }],
  "Retool": [],
  "HubSpot": [{ "firstName": "Jamie", "lastName": "Chen", "jobTitle": "Marketing Director", ... }]
}
```

This is why you always see Gong and HubSpot in development — it's intentional placeholder data so you can develop and test the UI without a real Huntd API key. Retool is included but empty, so it gets filtered out before the response is sent.

To use real competitor data, you need to:
1. Obtain a real `HUNTD_API_KEY` from the Huntd platform, or
2. Replace `huntdService.js` with a call to a real enrichment API such as Apollo.io, Clay, or Clearbit that can return tool usage by company domain.

---

## Troubleshooting

**Sidebar doesn't appear**
- Check that the extension is enabled in `chrome://extensions`
- Check that the URL matches `https://www.linkedin.com/in/*` or `/company/*`
- Click the refresh icon on the extension card after any file changes
- Open Chrome DevTools on the LinkedIn tab → Console tab and look for errors

**"API key required" message in sidebar**
- Open the extension popup and enter the `EXTENSION_API_KEY` value from your `.env` file
- Make sure you clicked Save

**"Backend unreachable" / NETWORK_ERROR**
- Confirm the backend is running: `curl http://localhost:3002/api/health`
- Confirm the Backend URL in the popup matches the port in your `.env` (e.g. `http://localhost:3002`)
- Check that no firewall is blocking localhost connections

**HTTP 401 from backend**
- The API key in the extension popup does not match `EXTENSION_API_KEY` in `.env`
- They must be exactly the same string

**HTTP 429 from backend**
- You've made more than 100 requests in the last hour from your IP
- Wait an hour or restart the backend (the rate limit counter resets on restart since it's in-memory)

**Name shows as "Unknown Profile"**
- LinkedIn's DOM may not have finished rendering — wait a moment and scroll the page slightly to trigger a re-render
- LinkedIn periodically changes their HTML class names. If this persists, open DevTools on the profile page, inspect the `<h1>` element, and update the selectors in `content/content.js`

**Always seeing Gong + HubSpot for every profile**
- This is expected in development mode. See [Development mode and mock data](#development-mode-and-mock-data).

---

## Project file structure

```
huntd-lens/
├── backend/
│   ├── .env                        ← your local environment variables (never commit this)
│   ├── .env.example                ← template showing required variables
│   ├── package.json                ← Node.js dependencies and npm scripts
│   ├── server.js                   ← Express app entry point
│   ├── routes/
│   │   ├── health.js               ← GET /api/health
│   │   └── profile.js              ← POST /api/profile (main enrichment endpoint)
│   ├── middleware/
│   │   ├── auth.js                 ← API key validation (x-api-key header)
│   │   ├── cache.js                ← LRU in-memory cache (500 entries, 6-hour TTL)
│   │   └── rateLimit.js            ← 100 requests/hour/IP rate limiter
│   ├── services/
│   │   ├── huntdService.js         ← calls Huntd external API, falls back to mock in dev
│   │   ├── icpScorer.js            ← ICP score calculation (0–100)
│   │   └── linkedinScraper.js      ← normalises and sanitises incoming profile data
│   └── utils/
│       └── logger.js               ← Winston JSON logger
│
└── extension/
    ├── manifest.json               ← Chrome Extension Manifest V3 config
    ├── background/
    │   └── background.js           ← service worker, handles all fetch() calls
    ├── content/
    │   ├── content.js              ← injected into LinkedIn pages, scrapes DOM
    │   ├── sidebar.js              ← builds and updates the sidebar HTML
    │   └── sidebar.css             ← sidebar styles (dark glassmorphism theme)
    ├── popup/
    │   ├── popup.html              ← settings popup HTML
    │   ├── popup.js                ← settings popup logic
    │   └── popup.css               ← settings popup styles
    ├── utils/
    │   ├── scorer.js               ← client-side ICP scorer (offline fallback)
    │   └── templates.js            ← outreach email template generator
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```
