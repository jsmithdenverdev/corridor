# Corridor

Hyper-local, vibe-based traffic companion for the I-70 Mountain Corridor (Georgetown to Eisenhower Tunnel).

**Philosophy:** "Don't show me a map; tell me if I should get dinner."

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Push database schema to Supabase
bun run db:push

# Run the worker locally
bun run dev:worker

# Run the web app locally
bun run dev:web
```

## Architecture

```
Fly.io Scheduler (5min) → Worker → CDOT API + Claude 3 Haiku → Supabase → React PWA (Realtime)
```

## Project Structure

```
corridor/
├── apps/
│   ├── worker/          # Fly.io background worker
│   │   ├── src/
│   │   │   ├── cdot/    # CDOT API integration
│   │   │   ├── ai/      # Claude vibe scoring
│   │   │   └── db/      # Drizzle database operations
│   │   ├── Dockerfile
│   │   └── fly.toml
│   └── web/             # React PWA frontend
│       └── src/
│           ├── components/
│           ├── hooks/
│           └── lib/
├── packages/
│   └── shared/          # Shared types, schemas, constants
└── drizzle/             # Database migrations
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (end-to-end)
- **Database:** Supabase (Postgres) + Realtime
- **ORM:** Drizzle
- **AI:** Anthropic SDK (Claude 3 Haiku)
- **Validation:** Zod
- **Hosting:** Fly.io (scale-to-zero worker)
- **Frontend:** React + Vite PWA

## Environment Variables

```bash
# CDOT API
CDOT_API_KEY=

# Anthropic (Claude)
ANTHROPIC_API_KEY=

# Supabase
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=

# Fly.io (deployment)
FLY_API_TOKEN=

# Frontend (Vite prefix)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Deployment

### Worker (Fly.io)

```bash
cd apps/worker
fly launch
fly secrets set CDOT_API_KEY=... ANTHROPIC_API_KEY=... DATABASE_URL=...
fly deploy
```

### Web (Static hosting)

```bash
bun run build:web
# Deploy apps/web/dist to Vercel, Netlify, etc.
```

## Development

```bash
# Type check all packages
bun run typecheck

# Run worker once
bun run dev:worker

# Run web dev server
bun run dev:web

# Open Drizzle Studio
bun run db:studio
```

## License

MIT
