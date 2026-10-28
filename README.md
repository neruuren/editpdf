# web_node.jsBackend_reactFrontend

![CI](https://github.com/neruuren/web_node.jsBackend_reactFrontend/actions/workflows/ci.yml/badge.svg)

in production mode, The node.js backend serve the static files of the REACT frontend

For auto format code with prettier when save file, VScode should have this config in settings.json:

```shell
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

a pre-commit hook (thanks to Husky) runs `lint-staged` (eslint + prettier on staged files only, fixes are re-staged automatically so no extra commit is needed) then `npm run test:backend`.

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint, tests and build on every push/PR to `main`.

## environment variables

Backend configuration lives in `backend/.env` (copy `backend/.env.example` to get started):

`PORT` → _port the backend listens on (default: 5000)_  
`CORS_ORIGIN` → _origin allowed to call the API (default: http://localhost:5173, the Vite dev server)_

## list of commands :

### development:

`npm clean` → _delete all modules directories (even frontend and backend), then, launch npm install_  
`npm install` → _after root install, launch automatically backend and frontend install (postinstall)_  
`npm run startDev` → _launch in 1 time backend and frontend servers_  
`npm run lint:backend` → _launch linter for backend_  
`npm run lint:frontend` → _launch linter for frontend_  
`npm run lint` → _launch linter for both frontend and backend_  
`npm run format` → _launch prettier_  
`npm run test:backend` → _run backend tests (Jest)_  
`npm run test:frontend` → _run frontend tests (Vitest)_  
`npm run test` → _run both backend and frontend tests_

### production:

`npm run build` → _lit install production dependencies and compile the frontend_  
`npm run start` → _it launch the backend server_
