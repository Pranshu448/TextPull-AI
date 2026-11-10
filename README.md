# TextPull AI

## Health monitoring

Use this URL in PagerMind for HTTP health checks:

`https://textpull-ai.onrender.com/health`

It returns HTTP 200 with:

```json
{"ok":true,"service":"textpull-backend"}
```

The deployment root (`https://textpull-ai.onrender.com/`) also returns HTTP
200 so a generic monitor configured with the base URL does not report a false
outage. The dedicated `/health` endpoint is preferred because it is explicitly
configured as Render's health check and is sent with `Cache-Control: no-store`.
