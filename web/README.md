# Tavily Load Balancer - Web UI

A Vue 3 + Vite + Element Plus application for managing the Tavily Load Balancer.

## Features

- **Dashboard**: System uptime, request stats, and quota usage.
- **API Keys**: Manage API keys (create, enable, disable, delete).
- **Statistics**: Tool usage distribution and per-key statistics.
- **Logs**: Searchable and filterable request logs.
- **Settings**: System configuration.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

## Development

Run the development server:
```bash
npm run dev
```

## Build

Build for production (outputs to `public/`):
```bash
npm run build
```

## Testing

Run unit tests and check coverage:
```bash
npm run test
```

## Architecture

- **Framework**: Vue 3 (Composition API)
- **State Management**: Pinia
- **UI Library**: Element Plus
- **Build Tool**: Vite
- **Testing**: Vitest
