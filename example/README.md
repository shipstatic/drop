# Drop + Ship Example

A small React app that prepares files with `@shipstatic/drop` and publishes
them with `@shipstatic/ship`. It needs no account: the site goes live right
away.

## What it shows

- Drag and drop for files, folders and ZIP archives, with a file picker as
  the fallback
- One piece of UI per phase: `idle`, `processing`, `ready` and `error`
- The name of what was dropped, and the list of files with each one's status
- A deploy button that is enabled only when the files are ready
- The deployment's URL on success, and the reason when a deploy is refused
- A project that needs building first (`drop.needsBuild`) sent to be built

## Running

```bash
pnpm install  # Install dependencies
pnpm dev      # Start the dev server at http://localhost:5173
pnpm build    # Typecheck and build
```

## The code

The whole example is [`src/App.tsx`](./src/App.tsx). The hook does the file
work, and the deploy is one call:

```tsx
const drop = useDrop({ ship });

await ship.deployments.upload(drop.getFilesForUpload());
```

## Learn more

- [@shipstatic/drop](../README.md): everything the hook returns
- [@shipstatic/ship](https://github.com/shipstatic/ship#readme): the SDK
