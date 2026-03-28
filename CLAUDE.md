# BigDawg Web — Claude Instructions

## Deploy after every change
Always build and deploy automatically after completing code changes. Do not ask for permission.

Build + deploy command (must use Node 18):
```
export PATH=~/.nvm/versions/node/v18.20.8/bin:$PATH && npm run build && firebase deploy --only hosting
```

## Stack
- Vite + React + TypeScript frontend
- Firebase (Firestore, Auth, Storage, Hosting)
- Firebase Cloud Functions v2 (Node 18) in `functions/`
- Tailwind CSS
- `@dnd-kit/sortable` for drag-and-drop tab bars
