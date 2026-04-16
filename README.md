# TextPull AI

TextPull AI is now organized as a product-ready repo with three clear surfaces:

```text
root/
├── extension/   Chrome extension frontend (MV3)
├── backend/     Secure Node.js API for RAG + AI providers
├── web/         Landing page / product website
└── README.md
```

## What This Product Does

Users can:

1. Visit the landing page to understand the product.
2. Install the Chrome extension.
3. Open any article, tutorial, or documentation page.
4. Generate a grounded summary.
5. Ask follow-up questions that stay tied to the page context.

The extension calls only the backend. Provider keys stay on the server in `.env`.

## Folder Structure

```text
extension/
  manifest.json
  content.js
  popup.html
  popup.css
  popup.js
  icons/

backend/
  package.json
  .env.example
  render.yaml
  src/
    index.js
    routes/askRoutes.js
    controllers/askController.js
    services/aiService.js
    services/ragService.js
    services/sessionStore.js
    middleware/rateLimiter.js
    middleware/errorHandler.js
    utils/logger.js

web/
  index.html
  styles.css
  script.js
  vercel.json
```

## Architecture Overview

### Extension

- Extracts visible page content with `content.js`
- Sends page text and chat questions to `POST /ask`
- Stores only local extension preferences like theme and backend URL
- Never talks directly to Groq or Gemini

### Backend

- Express API with route/controller/service separation
- `POST /ask` handles both:
  - `type: "analyze"`
  - `type: "chat"`
- RAG pipeline:
  - chunk page text
  - retrieve relevant chunks for follow-up chat
  - pass grounded context into the active model
- AI provider fallback:
  - `groq -> gemini -> ollama` by default
- Security:
  - provider keys live only in `.env`
- Production basics:
  - rate limiting
  - structured logging
  - central error handling

### Web

- Marketing landing page
- Install button with Chrome Web Store placeholder
- Product explanation, features, demo placeholder, and tech stack section

## Backend Environment Variables

Copy `backend/.env.example` to `backend/.env`.

Important values:

- `PORT=8787`
- `ALLOWED_ORIGINS=http://localhost:3000,chrome-extension://YOUR_EXTENSION_ID`
- `PRIMARY_PROVIDER=groq`
- `FALLBACK_PROVIDERS=groq,gemini,ollama`
- `GROQ_API_KEY=...`
- `GEMINI_API_KEY=...`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`
- `OLLAMA_MODEL=qwen2.5-coder:3b`

## Run Locally

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Backend runs on:

```text
http://localhost:8787
```

Health check:

```text
GET http://localhost:8787/health
```

### 2. Extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension/` folder
5. In the popup, keep backend URL as `http://localhost:8787`

### 3. Web

The current landing page is static, so you can open `web/index.html` directly or serve it with any static host.

For a quick local preview:

```bash
cd web
python3 -m http.server 3000
```

Then open:

```text
http://localhost:3000
```

## Deploy Backend on Render

1. Push the repo to GitHub
2. Create a new Render Web Service
3. Set the root directory to `backend`
4. Build command:

```text
npm install
```

5. Start command:

```text
npm start
```

6. Add environment variables from `.env.example`
7. After deploy, copy the public backend URL into the extension popup backend field

You can also use the included `backend/render.yaml` as a starting point.

## Deploy Frontend on Vercel

1. Create a new Vercel project
2. Set root directory to `web`
3. Deploy as a static site
4. Update the Chrome Web Store install link placeholder later

## Publish the Extension

1. Verify the extension points to your deployed backend URL
2. Zip the `extension/` folder contents
3. Upload to the Chrome Web Store Developer Dashboard
4. Add screenshots, product description, privacy policy, and support link
5. Replace the placeholder install link in `web/index.html` after publishing

## Security Notes

- Keep all provider keys in backend `.env`
- Do not expose Groq, Gemini, or Ollama credentials in extension code
- Restrict `ALLOWED_ORIGINS` in production
- Add auth / user accounts later if you want quota per user

## Resume-Friendly Highlights

- Chrome Extension (MV3)
- Node.js + Express backend
- RAG-based grounded QA
- AI provider fallback architecture
- Rate limiting and structured logging
- Static landing page for product onboarding

## Suggested Next Steps

1. Add source highlighting in responses
2. Add user auth and per-user quotas
3. Add persistent session storage with Redis or Postgres
4. Add OpenAI and Claude adapters
5. Publish the website and Chrome Web Store listing
