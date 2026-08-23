# Desktop API sidecar

Local desktop builds embed FastAPI here. `npm run build:desktop` runs the sidecar step automatically if this folder is missing.

```bash
npm run build:desktop:sidecar
```

Output: `recombyn-api/recombyn-api.exe` (+ `_internal/` onedir).  
`npm run build:desktop` runs that step automatically when this folder is missing.
