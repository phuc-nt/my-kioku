# Skill Domain Routing

When a user's task involves a specific domain, use these decision trees to pick the RIGHT skill based on user intent.

## Frontend / UI

```
User wants to...
├── Replicate a mockup, screenshot, or video    → /mk:frontend-design
├── Build React/TS components with best practices → /mk:frontend-development
├── Style with Tailwind CSS + shadcn/ui          → /mk:ui-styling
├── Choose colors, fonts, layout, design system  → /mk:ui-ux-pro-max
├── Audit existing UI for accessibility/UX       → /mk:web-design-guidelines
├── Apply React performance patterns             → /mk:react-best-practices
├── Build with Stitch (AI design generation)     → /mk:stitch
├── Create 3D / WebGL / Three.js experience      → /mk:threejs
├── Write GLSL shaders / procedural graphics     → /mk:shader
└── Build programmatic video with Remotion       → /mk:remotion
```

## Codebase Understanding

```
User wants to...
├── Quick file search, locate specific code     → /mk:scout
├── Full codebase dump for LLM context          → /mk:repomix
└── Semantic go-to-definition, find-usages      → /mk:gkg
```

## Backend / API

```
User wants to...
├── Build REST/GraphQL API (NestJS, FastAPI, Django) → /mk:backend-development
├── Add authentication (OAuth, JWT, passkeys)        → /mk:better-auth
└── Integrate payments (Stripe, Polar, SePay)        → /mk:payment-integration
```

## Database

```
User wants to...
├── Design schemas, write SQL/NoSQL queries     → /mk:databases
├── Optimize indexes, migrations, replication   → /mk:databases
└── Add auth with database-backed sessions      → /mk:better-auth
```

## Infrastructure / Deployment

```
User wants to...
├── Deploy to Vercel, Netlify, Railway, Fly.io   → /mk:deploy
└── Docker, Kubernetes, CI/CD pipelines, GitOps   → /mk:devops
```

## Security

```
User wants to...
├── STRIDE/OWASP security audit with auto-fix    → /mk:security
└── Scan for secrets, vulnerabilities, OWASP patterns → /mk:security-scan
```

## AI / LLM

```
User wants to...
├── Optimize context, agent architecture, memory → /mk:context-engineering
├── Generate llms.txt, LLM-friendly docs         → /mk:llms
├── Build AI agents with Google ADK              → /mk:google-adk-python
└── Generate/analyze images, audio, video with AI → /mk:ai-multimodal
```

## MCP (Model Context Protocol)

```
User wants to...
├── Build a new MCP server                       → /mk:mcp-builder
├── Discover and manage existing MCP tools       → /mk:mcp-management
└── Execute MCP tools directly                   → /mk:use-mcp
```

## Testing / Browser

```
User wants to...
├── Run test suites, coverage reports, TDD       → /mk:test
├── Web-specific testing (Playwright, k6, a11y)  → /mk:web-testing
├── Puppeteer automation, screenshots, scraping  → /mk:chrome-devtools
└── AI-driven browser sessions, Browserbase cloud → /mk:agent-browser
```

## Media

```
User wants to...
├── Process video/audio (FFmpeg), images (ImageMagick) → /mk:media-processing
└── Generate AI images (Imagen, Nano Banana)           → /mk:ai-artist
```

## Documentation

```
User wants to...
├── Update project docs (codebase-summary, PDR)  → /mk:docs
├── Search library/framework docs (context7)     → /mk:docs-seeker
├── Build docs site with Mintlify                → /mk:mintlify
└── Create diagrams (Mermaid v11 syntax)         → /mk:mermaidjs-v11
```

## Content / Copy

```
User wants to...
├── Write landing page, email, headline copy     → /mk:copywriting
├── Brand identity, logos, banners               → /ckm:design
└── Create Excalidraw diagrams                   → /mk:excalidraw
```

## Frameworks

```
User wants to...
├── Next.js App Router, RSC, Turborepo           → /mk:web-frameworks
├── TanStack Start/Form/AI                       → /mk:tanstack
├── React Native, Flutter, SwiftUI               → /mk:mobile-development
└── Shopify apps, Polaris, Liquid templates       → /mk:shopify
```

## Usage Notes

- Pick ONE skill per distinct user intent
- If a task spans two domains (e.g. "build + deploy"), suggest the primary skill and mention the secondary
- Domain skills combine with core workflow: `/mk:plan` → domain skill → `/mk:cook`
- Skills not listed here are either core workflow skills (see `skill-workflow-routing.md`) or utility skills activated on demand (e.g. `/mk:ask`, `/mk:preview`, `/mk:sequential-thinking`)
